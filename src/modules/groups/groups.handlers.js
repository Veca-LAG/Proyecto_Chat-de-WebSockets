'use strict';

const { randomUUID }    = require('crypto');
const pool              = require('../../db/pool');
const { sanitizeText }  = require('../../utils/sanitize');
const { sendJson }      = require('../../websocket/helpers');
const { publishCluster }= require('../../redis/publisher');
const { redis }         = require('../../redis/clients');
const { users }         = require('../../websocket/state');
const { logEvent }      = require('../../utils/logger');
const { MAX_MESSAGE_LENGTH, MAX_HISTORY, INVITE_SECONDS } = require('../../config');
const { moderateMessageText, sendMessageToLocalUser } = require('../moderation/moderation.service');
const { saveModerationAudit } = require('../moderation/moderation.repository');
const { buildReplySnapshot }  = require('../messages/messages.service');
const { getOnlineUserIds }    = require('../../utils/presence');
const { getGroupRole, broadcastGroupListsLocal } = require('./groups.service');

async function handleCreateGroup(ws, payload) {
    const creator          = users.get(ws);
    const name             = sanitizeText(payload.name, 40);
    const selectedMemberIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];

    if (!creator?.nickname || !name) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Nombre de grupo inválido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const activeIds = new Set(await getOnlineUserIds());
    const memberIds = new Set([creator.id]);
    selectedMemberIds.forEach((memberId) => {
        if (activeIds.has(memberId) && memberId !== creator.id) memberIds.add(memberId);
    });

    if (memberIds.size < 2) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Selecciona al menos un participante activo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const group = {
        id:        randomUUID(),
        name,
        createdBy: creator.id,
        createdAt: new Date().toISOString()
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('INSERT INTO groups(id, name, created_by, created_at) VALUES($1,$2,$3,$4)', [group.id, group.name, group.createdBy, group.createdAt]);
        for (const memberId of memberIds) {
            await client.query(
                `INSERT INTO group_members(group_id, user_id, role) VALUES($1,$2,$3)
                 ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role, hidden_for_user = FALSE`,
                [group.id, memberId, memberId === creator.id ? 'owner' : 'member']
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    await broadcastGroupListsLocal();
    await publishCluster({ event: 'group_lists_update' });
    logEvent(`${creator.nickname} creó el grupo ${name}`);
}

async function handleAddGroupMembers(ws, payload) {
    const requester   = users.get(ws);
    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 LIMIT 1', [payload.groupId]);
    const group       = groupResult.rows[0];
    const selectedIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];

    if (!requester?.nickname || !group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Grupo no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }

    const isMember = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, requester.id]);
    if (isMember.rowCount === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No eres miembro de este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }
    if (!['owner', 'admin'].includes(isMember.rows[0]?.role)) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo administradores pueden agregar miembros.' }, timestamp: new Date().toISOString() });
        return;
    }

    const activeIds = new Set(await getOnlineUserIds());
    let added = 0;
    for (const id of selectedIds) {
        if (activeIds.has(id)) {
            const insert = await pool.query(
                `INSERT INTO group_members(group_id, user_id, role, hidden_for_user) VALUES($1,$2,'member',FALSE)
                 ON CONFLICT (group_id, user_id) DO UPDATE SET hidden_for_user = FALSE`,
                [group.id, id]
            );
            added += insert.rowCount;
        }
    }

    if (added === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No se agregaron nuevos miembros.' }, timestamp: new Date().toISOString() });
        return;
    }

    await broadcastGroupListsLocal();
    await publishCluster({ event: 'group_lists_update' });
}

async function handlePromoteGroupAdmin(ws, payload) {
    const requester   = users.get(ws);
    const groupId     = sanitizeText(payload.groupId, 80);
    const targetUserId = sanitizeText(payload.targetUserId, 80);
    if (!requester?.id || !groupId || !targetUserId) return;

    const role = await getGroupRole(groupId, requester.id);
    if (role !== 'owner') {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo el owner puede nombrar administradores.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE group_members SET role = 'admin', hidden_for_user = FALSE WHERE group_id = $1 AND user_id = $2 AND role <> 'owner'`,
        [groupId, targetUserId]
    );
    await broadcastGroupListsLocal();
    await publishCluster({ event: 'group_lists_update' });
}

async function handleLeaveGroup(ws, payload) {
    const requester = users.get(ws);
    const groupId   = sanitizeText(payload.groupId, 80);
    if (!requester?.id || !groupId) return;

    const role = await getGroupRole(groupId, requester.id);
    if (role === 'owner') {
        const otherAdmins = await pool.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id <> $2 AND role IN ('owner','admin') LIMIT 1`,
            [groupId, requester.id]
        );
        if (otherAdmins.rowCount === 0) {
            sendJson(ws, { type: 'group_error', payload: { text: 'Antes de salir, nombra a otro administrador.' }, timestamp: new Date().toISOString() });
            return;
        }
    }

    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, requester.id]);
    sendJson(ws, { type: 'group_deleted', payload: { groupId }, timestamp: new Date().toISOString() });
    await broadcastGroupListsLocal();
    await publishCluster({ event: 'group_lists_update' });
}

async function handleHideGroupChat(ws, payload) {
    const requester = users.get(ws);
    const groupId   = sanitizeText(payload.groupId, 80);
    if (!requester?.id || !groupId) return;

    await pool.query(
        `UPDATE group_members SET hidden_for_user = TRUE WHERE group_id = $1 AND user_id = $2`,
        [groupId, requester.id]
    );
    sendJson(ws, { type: 'group_deleted', payload: { groupId }, timestamp: new Date().toISOString() });
    await broadcastGroupListsLocal();
}

async function handleDeleteGroupEveryone(ws, payload) {
    const requester = users.get(ws);
    const groupId   = sanitizeText(payload.groupId, 80);
    if (!requester?.id || !groupId) return;

    const role = await getGroupRole(groupId, requester.id);
    if (!['owner', 'admin'].includes(role)) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo administradores pueden eliminar el grupo para todos.' }, timestamp: new Date().toISOString() });
        return;
    }

    const members = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
    await pool.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [groupId]);
    const memberIds = members.rows.map((r) => r.user_id);
    const ts = new Date().toISOString();
    memberIds.forEach((memberId) => sendMessageToLocalUser(memberId, 'group_deleted', { groupId }, ts));
    await broadcastGroupListsLocal();
    await publishCluster({ event: 'group_deleted', payload: { groupId }, memberIds });
    await publishCluster({ event: 'group_lists_update' });
}

async function handleGenerateInvite(ws, payload) {
    const requester   = users.get(ws);
    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 LIMIT 1', [payload.groupId]);
    const group       = groupResult.rows[0];

    if (!requester?.nickname || !group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No puedes generar una invitación para este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const isMember = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, requester.id]);
    if (isMember.rowCount === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No puedes generar una invitación para este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    await redis.setEx(`invite:${token}`, INVITE_SECONDS, group.id);

    sendJson(ws, {
        type: 'invite_link',
        payload: { token, groupId: group.id, groupName: group.name },
        timestamp: new Date().toISOString()
    });
}

async function handleJoinByInvite(ws, payload) {
    const requester = users.get(ws);
    const token     = sanitizeText(payload.token, 80);
    const groupId   = await redis.get(`invite:${token}`);

    if (!requester?.nickname || !groupId) {
        sendJson(ws, { type: 'group_error', payload: { text: 'El enlace de invitación no es válido o expiró.' }, timestamp: new Date().toISOString() });
        return;
    }

    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 LIMIT 1', [groupId]);
    const group       = groupResult.rows[0];
    if (!group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'El grupo ya no existe.' }, timestamp: new Date().toISOString() });
        return;
    }

    const insert = await pool.query(
        `INSERT INTO group_members(group_id, user_id, role, hidden_for_user) VALUES($1,$2,'member',FALSE)
         ON CONFLICT (group_id, user_id) DO UPDATE SET hidden_for_user = FALSE`,
        [groupId, requester.id]
    );
    if (insert.rowCount === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Ya eres miembro de este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    sendJson(ws, {
        type: 'join_success',
        payload: { id: requester.id, nickname: requester.nickname, groupId: group.id, groupName: group.name },
        timestamp: new Date().toISOString()
    });
    await broadcastGroupListsLocal();
    await publishCluster({ event: 'group_lists_update' });
}

async function handleGroupMessage(ws, payload, timestamp) {
    try {
        const sender      = users.get(ws);
        const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [payload.groupId]);
        const group       = groupResult.rows[0];
        const textOriginal = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);

        if (!sender?.nickname || !group || !textOriginal) {
            sendJson(ws, { type: 'group_error', payload: { text: 'Mensaje de grupo inválido.' }, timestamp: new Date().toISOString() });
            return;
        }

        const isMember = await pool.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, sender.id]);
        if (isMember.rowCount === 0) {
            sendJson(ws, { type: 'group_error', payload: { text: 'Mensaje de grupo inválido.' }, timestamp: new Date().toISOString() });
            return;
        }

        const moderation    = moderateMessageText(textOriginal);
        const textCensored  = moderation.textCensored;
        const reply         = buildReplySnapshot(payload);
        const isForwarded   = Boolean(payload.isForwarded);
        const forwardedFromId = sanitizeText(payload.forwardedFromId || '', 80) || null;

        const message = {
            id: randomUUID(),
            groupId:   group.id,
            groupName: group.name,
            fromId:    sender.id,
            from:      sender.nickname,
            text:      textCensored,
            textOriginal,
            textCensored,
            replyTo:       reply.replyTo,
            isForwarded,
            forwardedFromId,
            deletedForAll: false,
            deletedBy:     null,
            timestamp:     timestamp || new Date().toISOString()
        };

        await pool.query(
            `INSERT INTO group_messages
             (id, group_id, group_name, from_id, from_nickname, text, text_original, text_censored, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [message.id, message.groupId, message.groupName, message.fromId, message.from, message.textCensored,
             textOriginal, textCensored, reply.replyToId, reply.replyAuthor, reply.replyText,
             isForwarded, forwardedFromId, message.timestamp]
        );
        await pool.query(
            `DELETE FROM group_messages gm
             WHERE gm.group_id = $1
             AND gm.id NOT IN (SELECT id FROM group_messages WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2)`,
            [message.groupId, MAX_HISTORY]
        );

        const membersResult = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [group.id]);
        await saveModerationAudit({ messageId: message.id, userId: sender.id, kind: 'group', matchedTerms: moderation.matchedTerms });
        const memberIds = membersResult.rows.map((row) => row.user_id);
        memberIds.forEach((memberId) => sendMessageToLocalUser(memberId, 'group_msg', message, message.timestamp));
        await publishCluster({ event: 'group_msg', payload: message, memberIds });
        await broadcastGroupListsLocal();
        await publishCluster({ event: 'group_lists_update' });
    } catch (error) {
        console.error('Error al procesar mensaje de grupo:', error);
        sendJson(ws, { type: 'group_error', payload: { text: 'No se pudo enviar el mensaje de grupo.' }, timestamp: new Date().toISOString() });
    }
}

async function handleDeleteGroupMessage(ws, payload) {
    const requester = users.get(ws);
    const id        = sanitizeText(payload.id, 80);
    const groupId   = sanitizeText(payload.groupId, 80);

    if (!requester?.id || !id || !groupId) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solicitud de eliminación inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    const result  = await pool.query('SELECT * FROM group_messages WHERE id = $1 LIMIT 1', [id]);
    const message = result.rows[0];

    if (!message) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Mensaje no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }
    if (message.from_id !== requester.id) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo puedes eliminar para todos mensajes enviados por ti.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE group_messages SET deleted_for_all = TRUE, deleted_by = $2, deleted_at = NOW(), text = '' WHERE id = $1`,
        [id, requester.id]
    );

    const membersResult = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
    const memberIds = membersResult.rows.map((row) => row.user_id);
    const ts = new Date().toISOString();
    memberIds.forEach((memberId) => sendMessageToLocalUser(memberId, 'group_delete', { id, groupId, deletedBy: requester.id }, ts));
    await publishCluster({
        event: 'group_delete',
        payload: { id, groupId, deletedBy: requester.id },
        memberIds,
        originConnectionId: ws.connectionId
    });
}

module.exports = {
    handleCreateGroup,
    handleAddGroupMembers,
    handlePromoteGroupAdmin,
    handleLeaveGroup,
    handleHideGroupChat,
    handleDeleteGroupEveryone,
    handleGenerateInvite,
    handleJoinByInvite,
    handleGroupMessage,
    handleDeleteGroupMessage
};
