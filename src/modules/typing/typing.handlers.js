'use strict';

const pool              = require('../../db/pool');
const { sanitizeText }  = require('../../utils/sanitize');
const { broadcastLocal, sendToLocalUser } = require('../../websocket/helpers');
const { publishCluster }= require('../../redis/publisher');
const { users }         = require('../../websocket/state');

async function handleTyping(ws, payload) {
    const user = users.get(ws);
    if (!user?.nickname) return;

    const chatType = ['global', 'private', 'group'].includes(payload.chatType) ? payload.chatType : 'global';
    const targetId = sanitizeText(payload.targetId || '', 80);

    const typingPayload = {
        fromId:    user.id,
        nickname:  user.nickname,
        isTyping:  Boolean(payload.isTyping),
        chatType,
        targetId:  chatType === 'global' ? 'global' : targetId
    };

    await publishCluster({
        event: 'typing_status',
        payload: typingPayload,
        originUserId:     user.id,
        originConnectionId: ws.connectionId
    });
}

async function deliverTypingStatus(payload, originConnectionId = null) {
    const message = { type: 'typing_status', payload, timestamp: new Date().toISOString() };

    if (payload.chatType === 'global') {
        broadcastLocal(message, originConnectionId);
        return;
    }

    if (payload.chatType === 'private') {
        sendToLocalUser(payload.targetId, message);
        return;
    }

    if (payload.chatType === 'group') {
        const members = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [payload.targetId]);
        members.rows
            .map((row) => row.user_id)
            .filter((memberId) => memberId !== payload.fromId)
            .forEach((memberId) => sendToLocalUser(memberId, message));
    }
}

module.exports = { handleTyping, deliverTypingStatus };
