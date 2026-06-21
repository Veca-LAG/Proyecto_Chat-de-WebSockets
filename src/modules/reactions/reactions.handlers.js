'use strict';

const pool              = require('../../db/pool');
const { sanitizeText }  = require('../../utils/sanitize');
const { sendJson, broadcastLocal }      = require('../../websocket/helpers');
const { publishCluster }= require('../../redis/publisher');
const { users }         = require('../../websocket/state');
const { sendMessageToLocalUser } = require('../moderation/moderation.service');

async function getReactionSnapshot(messageId) {
    const result = await pool.query(
        `SELECT emoji, ARRAY_AGG(user_id::text ORDER BY created_at ASC) AS users
         FROM message_reactions
         WHERE message_id = $1
         GROUP BY emoji
         ORDER BY emoji`,
        [messageId]
    );
    return result.rows.map((row) => ({ emoji: row.emoji, users: row.users || [] }));
}

async function handleReactMessage(ws, payload) {
    const user = users.get(ws);
    if (!user?.id) return;

    const messageId = sanitizeText(String(payload.messageId || ''), 80);
    const emoji     = String(payload.emoji || '').slice(0, 8);
    const action    = payload.action === 'remove' ? 'remove' : 'add';
    const kind      = payload.kind;
    const groupId   = payload.groupId  || null;
    const targetId  = payload.targetId || null;

    const allowedEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    if (!messageId || !allowedEmojis.includes(emoji) || !kind) return;

    if (action === 'remove') {
        await pool.query(
            'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
            [messageId, user.id]
        );
    } else {
        await pool.query(
            `INSERT INTO message_reactions(message_id, user_id, emoji, created_at)
             VALUES($1,$2,$3,NOW())
             ON CONFLICT(message_id, user_id)
             DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
            [messageId, user.id, emoji]
        );
    }

    const reactions    = await getReactionSnapshot(messageId);
    const reactPayload = { messageId, emoji, userId: user.id, action, kind, reactions };

    if (kind === 'global') {
        broadcastLocal({ type: 'message_reaction', payload: reactPayload, timestamp: new Date().toISOString() });
        await publishCluster({ event: 'message_reaction', payload: reactPayload });
    } else if (kind === 'private') {
        const targetIds = [user.id, targetId].filter(Boolean);
        const payloadWithTargets = { ...reactPayload, targetIds };
        targetIds.forEach((uid) => sendMessageToLocalUser(uid, 'message_reaction', payloadWithTargets, new Date().toISOString()));
        await publishCluster({ event: 'message_reaction', payload: payloadWithTargets });
    } else if (kind === 'group' && groupId) {
        const membersResult = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
        const memberIds     = membersResult.rows.map((r) => r.user_id);
        const payloadWithMembers = { ...reactPayload, memberIds };
        memberIds.forEach((uid) => sendMessageToLocalUser(uid, 'message_reaction', payloadWithMembers, new Date().toISOString()));
        await publishCluster({ event: 'message_reaction', payload: payloadWithMembers });
    }
}

module.exports = { getReactionSnapshot, handleReactMessage };
