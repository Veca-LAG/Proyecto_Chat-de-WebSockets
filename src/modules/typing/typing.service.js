'use strict';

const pool                  = require('../../db/pool');
const { broadcastLocal, sendToLocalUser } = require('../../websocket/helpers');
const { publishCluster }    = require('../../redis/publisher');

async function broadcastTyping(user, payload, connectionId) {
    const chatType = ['global', 'private', 'group'].includes(payload.chatType) ? payload.chatType : 'global';
    const targetId = String(payload.targetId || '').slice(0, 80);

    const typingPayload = {
        fromId:    user.id,
        nickname:  user.nickname,
        isTyping:  Boolean(payload.isTyping),
        chatType,
        targetId:  chatType === 'global' ? 'global' : targetId
    };

    await deliverTypingStatus(typingPayload, connectionId);
    await publishCluster({
        event: 'typing_status',
        payload: typingPayload,
        originUserId:       user.id,
        originConnectionId: connectionId
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
        const members = await pool.query(
            `SELECT user_id FROM group_members WHERE group_id = $1`, [payload.targetId]
        );
        members.rows
            .map((r) => r.user_id)
            .filter((id) => id !== payload.fromId)
            .forEach((id) => sendToLocalUser(id, message));
    }
}

module.exports = { broadcastTyping, deliverTypingStatus };
