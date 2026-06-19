'use strict';

const { randomUUID }    = require('crypto');
const pool              = require('../../db/pool');
const { sanitizeText }  = require('../../utils/sanitize');
const { sendJson }      = require('../../websocket/helpers');
const { publishCluster }= require('../../redis/publisher');
const { users }         = require('../../websocket/state');
const { SERVER_ID, MAX_MESSAGE_LENGTH, MAX_HISTORY } = require('../../config');
const { moderateMessageText } = require('../moderation/moderation.service');
const { saveModerationAudit } = require('../moderation/moderation.repository');
const { buildReplySnapshot }  = require('./messages.service');
const { findUserById }        = require('../auth/auth.repository');

async function handleMessage(ws, payload, timestamp) {
    try {
        const user         = users.get(ws);
        const textOriginal = sanitizeText(payload.text || payload.texto, MAX_MESSAGE_LENGTH);
        if (!user?.nickname || !textOriginal) return;

        const moderation    = moderateMessageText(textOriginal);
        const textCensored  = moderation.textCensored;
        const reply         = buildReplySnapshot(payload);
        const isForwarded   = Boolean(payload.isForwarded);
        const forwardedFromId = sanitizeText(payload.forwardedFromId || '', 80) || null;

        const message = {
            id: randomUUID(),
            fromId: user.id,
            from:   user.nickname,
            text:   textCensored,
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
            `INSERT INTO global_messages
             (id, from_id, from_nickname, text, text_original, text_censored, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [message.id, message.fromId, message.from, message.textCensored, textOriginal, textCensored,
             reply.replyToId, reply.replyAuthor, reply.replyText, isForwarded, forwardedFromId, message.timestamp]
        );
        await pool.query(
            `DELETE FROM global_messages WHERE id NOT IN (SELECT id FROM global_messages ORDER BY created_at DESC LIMIT $1)`,
            [MAX_HISTORY]
        );

        await saveModerationAudit({ messageId: message.id, userId: user.id, kind: 'global', matchedTerms: moderation.matchedTerms });
        await publishCluster({ event: 'broadcast', payload: message });
    } catch (error) {
        console.error('Error al procesar mensaje global:', error);
        sendJson(ws, { type: 'error', payload: { text: 'No se pudo enviar el mensaje.' }, timestamp: new Date().toISOString() });
    }
}

async function handlePrivate(ws, payload, timestamp) {
    try {
        const sender       = users.get(ws);
        const targetUser   = await findUserById(payload.targetId);
        const textOriginal = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);

        if (!sender?.nickname || !payload.targetId || payload.targetId === sender.id || !targetUser || !textOriginal) {
            sendJson(ws, { type: 'private_error', payload: { text: 'Mensaje privado inválido.' }, timestamp: new Date().toISOString() });
            return;
        }

        const moderation    = moderateMessageText(textOriginal);
        const textCensored  = moderation.textCensored;
        const reply         = buildReplySnapshot(payload);
        const isForwarded   = Boolean(payload.isForwarded);
        const forwardedFromId = sanitizeText(payload.forwardedFromId || '', 80) || null;

        const message = {
            id: randomUUID(),
            fromId: sender.id,
            from:   sender.nickname,
            toId:   targetUser.id,
            to:     targetUser.nickname,
            text:   textCensored,
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
            `INSERT INTO private_messages
             (id, from_id, from_nickname, to_id, to_nickname, text, text_original, text_censored, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [message.id, message.fromId, message.from, message.toId, message.to, message.textCensored,
             textOriginal, textCensored, reply.replyToId, reply.replyAuthor, reply.replyText,
             isForwarded, forwardedFromId, message.timestamp]
        );
        await pool.query(
            `DELETE FROM private_messages pm
             WHERE ((pm.from_id = $1 AND pm.to_id = $2) OR (pm.from_id = $2 AND pm.to_id = $1))
             AND pm.id NOT IN (
                SELECT id FROM private_messages
                WHERE ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))
                ORDER BY created_at DESC LIMIT $3
             )`,
            [message.fromId, message.toId, MAX_HISTORY]
        );

        await saveModerationAudit({ messageId: message.id, userId: sender.id, kind: 'private', matchedTerms: moderation.matchedTerms });
        await publishCluster({
            event: 'private_msg',
            payload: message,
            originServerId: SERVER_ID,
            originConnectionId: ws.connectionId
        });
    } catch (error) {
        console.error('Error al procesar privado:', error);
        sendJson(ws, { type: 'private_error', payload: { text: 'No se pudo enviar el mensaje privado.' }, timestamp: new Date().toISOString() });
    }
}

async function handleDeletePrivateMessage(ws, payload) {
    const requester = users.get(ws);
    const id        = sanitizeText(payload.id, 80);

    if (!requester?.id || !id) {
        sendJson(ws, { type: 'private_error', payload: { text: 'Solicitud de eliminación inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    const result  = await pool.query('SELECT * FROM private_messages WHERE id = $1 LIMIT 1', [id]);
    const message = result.rows[0];

    if (!message) {
        sendJson(ws, { type: 'private_error', payload: { text: 'Mensaje no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }
    if (message.from_id !== requester.id) {
        sendJson(ws, { type: 'private_error', payload: { text: 'Solo puedes eliminar para todos mensajes enviados por ti.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE private_messages SET deleted_for_all = TRUE, deleted_by = $2, deleted_at = NOW(), text = '' WHERE id = $1`,
        [id, requester.id]
    );
    await publishCluster({
        event: 'private_delete',
        payload: { id, deletedBy: requester.id, fromId: message.from_id, toId: message.to_id },
        originConnectionId: ws.connectionId
    });
}

async function handleDeleteGlobalMessage(ws, payload) {
    const requester = users.get(ws);
    const id        = sanitizeText(payload.id, 80);

    if (!requester?.id || !id) {
        sendJson(ws, { type: 'error', payload: { text: 'Solicitud de eliminación inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    const result  = await pool.query('SELECT * FROM global_messages WHERE id = $1 LIMIT 1', [id]);
    const message = result.rows[0];

    if (!message) {
        sendJson(ws, { type: 'error', payload: { text: 'Mensaje no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }
    if (message.from_id !== requester.id) {
        sendJson(ws, { type: 'error', payload: { text: 'Solo puedes eliminar para todos mensajes enviados por ti.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE global_messages SET deleted_for_all = TRUE, deleted_by = $2, deleted_at = NOW(), text = '' WHERE id = $1`,
        [id, requester.id]
    );
    await publishCluster({ event: 'global_delete', payload: { id, deletedBy: requester.id }, originConnectionId: ws.connectionId });
}

async function handleEditMessage(ws, payload) {
    const requester = users.get(ws);
    const id        = sanitizeText(payload.id, 80);
    const newText   = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);
    const kind      = payload.kind;

    if (!requester?.id || !id || !newText || !kind) {
        sendJson(ws, { type: 'error', payload: { text: 'Edición inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (kind === 'global') {
        const { rows } = await pool.query('SELECT * FROM global_messages WHERE id = $1 LIMIT 1', [id]);
        const msg = rows[0];
        if (!msg || msg.from_id !== requester.id) {
            sendJson(ws, { type: 'error', payload: { text: 'No puedes editar este mensaje.' }, timestamp: new Date().toISOString() });
            return;
        }
        const moderation = moderateMessageText(newText);
        const censored   = moderation.textCensored;
        await pool.query('UPDATE global_messages SET text = $1, text_original = $2, text_censored = $3 WHERE id = $4 AND deleted_for_all = FALSE', [censored, newText, censored, id]);
        await saveModerationAudit({ messageId: id, userId: requester.id, kind: 'global_edit', matchedTerms: moderation.matchedTerms });
        await publishCluster({ event: 'message_edited', payload: { id, textOriginal: newText, textCensored: censored, text: censored, kind: 'global' } });

    } else if (kind === 'private') {
        const { rows } = await pool.query('SELECT * FROM private_messages WHERE id = $1 LIMIT 1', [id]);
        const msg = rows[0];
        if (!msg || msg.from_id !== requester.id) {
            sendJson(ws, { type: 'private_error', payload: { text: 'No puedes editar este mensaje.' }, timestamp: new Date().toISOString() });
            return;
        }
        const moderation = moderateMessageText(newText);
        const censored   = moderation.textCensored;
        await pool.query('UPDATE private_messages SET text = $1, text_original = $2, text_censored = $3 WHERE id = $4 AND deleted_for_all = FALSE', [censored, newText, censored, id]);
        await saveModerationAudit({ messageId: id, userId: requester.id, kind: 'private_edit', matchedTerms: moderation.matchedTerms });
        await publishCluster({ event: 'message_edited', payload: { id, textOriginal: newText, textCensored: censored, text: censored, kind: 'private', fromId: msg.from_id, toId: msg.to_id } });

    } else if (kind === 'group') {
        const { rows } = await pool.query('SELECT * FROM group_messages WHERE id = $1 LIMIT 1', [id]);
        const msg = rows[0];
        if (!msg || msg.from_id !== requester.id) {
            sendJson(ws, { type: 'group_error', payload: { text: 'No puedes editar este mensaje.' }, timestamp: new Date().toISOString() });
            return;
        }
        const moderation = moderateMessageText(newText);
        const censored   = moderation.textCensored;
        await pool.query('UPDATE group_messages SET text = $1, text_original = $2, text_censored = $3 WHERE id = $4 AND deleted_for_all = FALSE', [censored, newText, censored, id]);
        await saveModerationAudit({ messageId: id, userId: requester.id, kind: 'group_edit', matchedTerms: moderation.matchedTerms });
        const members = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [msg.group_id]);
        await publishCluster({ event: 'message_edited', payload: { id, textOriginal: newText, textCensored: censored, text: censored, kind: 'group' }, memberIds: members.rows.map((r) => r.user_id) });
    }
}

module.exports = {
    handleMessage,
    handlePrivate,
    handleDeletePrivateMessage,
    handleDeleteGlobalMessage,
    handleEditMessage
};
