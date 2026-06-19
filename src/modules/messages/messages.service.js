'use strict';

const pool              = require('../../db/pool');
const { sanitizeText }  = require('../../utils/sanitize');
const { sendJson, getSocketsForUser } = require('../../websocket/helpers');
const { getOnlineUserIds } = require('../../utils/presence');
const { clientWantsCensorship } = require('../moderation/moderation.service');
const { getReactionSnapshot }   = require('../reactions/reactions.handlers');
const { findUserById }          = require('../auth/auth.repository');
const { toPublicUser }          = require('../../utils/presence');
const { MAX_HISTORY, MAX_MESSAGE_LENGTH } = require('../../config');

function buildReplySnapshot(payload = {}) {
    const reply = payload.replyTo || null;
    if (!reply && !payload.replyToId)
        return { replyToId: null, replyAuthor: null, replyText: null, replyTo: null };

    const replyToId   = sanitizeText(payload.replyToId || reply?.id || '', 80) || null;
    const replyAuthor = sanitizeText(reply?.nickname || reply?.author || reply?.from || '', 80) || null;
    const replyText   = sanitizeText(reply?.text || '', MAX_MESSAGE_LENGTH) || null;

    return {
        replyToId,
        replyAuthor,
        replyText,
        replyTo: replyToId || replyText
            ? { id: replyToId, nickname: replyAuthor || 'Usuario', text: replyText || '' }
            : null
    };
}

function rowToMessage(row, kind, censorshipEnabled = true) {
    const original      = row.text_original || row.text || '';
    const censored      = row.text_censored || row.text || original;
    const deletedForAll = Boolean(row.deleted_for_all);
    const text = deletedForAll
        ? ''
        : (censorshipEnabled ? censored : original);

    return {
        id:             row.id,
        fromId:         row.from_id,
        from:           row.from_nickname,
        text,
        replyTo: row.reply_to_id || row.reply_text ? {
            id:       row.reply_to_id,
            nickname: row.reply_author || 'Usuario',
            text:     row.reply_text   || ''
        } : null,
        isForwarded:    Boolean(row.is_forwarded),
        forwardedFromId: row.forwarded_from_id,
        deletedForAll,
        deletedBy:      row.deleted_by,
        timestamp:      row.created_at.toISOString(),
        kind
    };
}

async function getGlobalHistory(censorshipEnabled = true) {
    const result = await pool.query(
        `SELECT * FROM global_messages ORDER BY created_at DESC LIMIT $1`,
        [MAX_HISTORY]
    );
    const rows     = result.rows.reverse();
    const messages = [];
    for (const row of rows) {
        const message = rowToMessage(row, 'global', censorshipEnabled);
        message.reactions = await getReactionSnapshot(row.id);
        messages.push(message);
    }
    return messages;
}

async function getGroupsForUser(userId, censorshipEnabled = true) {
    const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.created_by, g.created_at, gm.role AS self_role
         FROM groups g
         INNER JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = $1 AND COALESCE(gm.hidden_for_user, FALSE) = FALSE AND g.deleted_at IS NULL
         ORDER BY g.created_at DESC`,
        [userId]
    );

    const groups = [];
    for (const group of groupsResult.rows) {
        const membersResult = await pool.query(
            `SELECT u.id, u.code, u.first_name, u.last_name, u.nickname, gm.role
             FROM group_members gm
             INNER JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY u.nickname ASC`,
            [group.id]
        );
        const onlineIds     = new Set(await getOnlineUserIds());
        const historyResult = await pool.query(
            `SELECT * FROM group_messages WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [group.id, MAX_HISTORY]
        );

        groups.push({
            id:        group.id,
            name:      group.name,
            createdBy: group.created_by,
            createdAt: group.created_at.toISOString(),
            selfRole:  group.self_role,
            members:   membersResult.rows.map((row) => ({ ...toPublicUser(row, onlineIds.has(row.id)), role: row.role })),
            history:   await Promise.all(historyResult.rows.reverse().map(async (message) => {
                const item = rowToMessage(message, 'group', censorshipEnabled);
                item.groupId   = message.group_id;
                item.groupName = message.group_name;
                item.reactions = await getReactionSnapshot(message.id);
                return item;
            }))
        });
    }
    return groups;
}

async function getPrivateConversationsForUser(userId, censorshipEnabled = true) {
    const result = await pool.query(
        `SELECT * FROM private_messages WHERE from_id = $1 OR to_id = $1 ORDER BY created_at ASC`,
        [userId]
    );

    const grouped = new Map();
    for (const message of result.rows) {
        const otherId = message.from_id === userId ? message.to_id : message.from_id;
        if (!grouped.has(otherId)) {
            const otherUser = await findUserById(otherId);
            if (!otherUser) continue;
            grouped.set(otherId, {
                user:      toPublicUser(otherUser, (await getOnlineUserIds()).includes(otherId)),
                messages:  [],
                updatedAt: message.created_at.toISOString()
            });
        }
        const conversation    = grouped.get(otherId);
        const privateMessage  = rowToMessage(message, 'private', censorshipEnabled);
        privateMessage.toId   = message.to_id;
        privateMessage.to     = message.to_nickname;
        privateMessage.direction  = message.from_id === userId ? 'out' : 'in';
        privateMessage.reactions  = await getReactionSnapshot(message.id);
        conversation.messages.push(privateMessage);
        conversation.updatedAt = message.created_at.toISOString();
    }

    return Array.from(grouped.values())
        .map((conv) => ({ ...conv, messages: conv.messages.slice(-MAX_HISTORY) }))
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function sendInitialState(ws, publicUser) {
    const censorshipEnabled = clientWantsCensorship(ws);
    sendJson(ws, {
        type: 'history',
        payload: { messages: await getGlobalHistory(censorshipEnabled) },
        timestamp: new Date().toISOString()
    });
    sendJson(ws, {
        type: 'group_list',
        payload: { groups: await getGroupsForUser(publicUser.id, censorshipEnabled) },
        timestamp: new Date().toISOString()
    });
    sendJson(ws, {
        type: 'private_conversations',
        payload: { conversations: await getPrivateConversationsForUser(publicUser.id, censorshipEnabled) },
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    buildReplySnapshot,
    rowToMessage,
    getGlobalHistory,
    getGroupsForUser,
    getPrivateConversationsForUser,
    sendInitialState
};
