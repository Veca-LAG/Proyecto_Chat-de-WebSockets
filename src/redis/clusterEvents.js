'use strict';

const { broadcastLocal, sendToLocalUser } = require('../websocket/helpers');
const { broadcastMessageLocal, sendMessageToLocalUser, loadModerationTerms } = require('../modules/moderation/moderation.service');
const { broadcastUserListLocal }   = require('../utils/presence');
const { broadcastGroupListsLocal } = require('../modules/groups/groups.service');
const { deliverTypingStatus }      = require('../modules/typing/typing.handlers');

async function handleClusterEvent(rawMessage) {
    let data;
    try {
        data = JSON.parse(rawMessage);
    } catch {
        return;
    }

    const timestamp = data.payload?.timestamp || data.emittedAt || new Date().toISOString();

    switch (data.event) {
        case 'broadcast':
            broadcastMessageLocal('broadcast', data.payload, timestamp);
            break;
        case 'private_msg':
            sendMessageToLocalUser(data.payload.toId,   'private_msg', data.payload, timestamp);
            sendMessageToLocalUser(data.payload.fromId, 'private_msg', data.payload, timestamp);
            break;
        case 'private_delete':
            sendToLocalUser(data.payload.toId,   { type: 'private_delete', payload: { id: data.payload.id, deletedBy: data.payload.deletedBy }, timestamp });
            sendToLocalUser(data.payload.fromId, { type: 'private_delete', payload: { id: data.payload.id, deletedBy: data.payload.deletedBy }, timestamp });
            break;
        case 'global_delete':
            broadcastLocal({ type: 'global_delete', payload: { id: data.payload.id, deletedBy: data.payload.deletedBy }, timestamp });
            break;
        case 'group_delete':
            (data.memberIds || []).forEach((memberId) => {
                sendToLocalUser(memberId, { type: 'group_delete', payload: { id: data.payload.id, groupId: data.payload.groupId, deletedBy: data.payload.deletedBy }, timestamp });
            });
            break;
        case 'group_deleted':
            (data.memberIds || []).forEach((memberId) => {
                sendToLocalUser(memberId, { type: 'group_deleted', payload: data.payload, timestamp });
            });
            break;
        case 'message_edited':
            if (data.payload.kind === 'global') {
                broadcastMessageLocal('message_edited', data.payload, timestamp);
            } else if (data.payload.kind === 'private') {
                sendMessageToLocalUser(data.payload.fromId, 'message_edited', data.payload, timestamp);
                sendMessageToLocalUser(data.payload.toId,   'message_edited', data.payload, timestamp);
            } else if (data.payload.kind === 'group') {
                (data.memberIds || []).forEach((memberId) => {
                    sendMessageToLocalUser(memberId, 'message_edited', data.payload, timestamp);
                });
            }
            break;
        case 'message_reaction':
            if (data.payload.kind === 'global') {
                broadcastLocal({ type: 'message_reaction', payload: data.payload, timestamp });
            } else if (data.payload.kind === 'private') {
                (data.payload.targetIds || []).forEach((uid) => {
                    sendToLocalUser(uid, { type: 'message_reaction', payload: data.payload, timestamp });
                });
            } else if (data.payload.kind === 'group') {
                (data.payload.memberIds || []).forEach((uid) => {
                    sendToLocalUser(uid, { type: 'message_reaction', payload: data.payload, timestamp });
                });
            }
            break;
        case 'group_msg':
            (data.memberIds || []).forEach((memberId) => {
                sendMessageToLocalUser(memberId, 'group_msg', data.payload, timestamp);
            });
            break;
        case 'typing_status':
            await deliverTypingStatus(data.payload, data.originConnectionId);
            break;
        case 'presence_update':
            await broadcastUserListLocal();
            break;
        case 'group_lists_update':
            await broadcastGroupListsLocal();
            break;
        case 'moderation_terms_updated':
            await loadModerationTerms();
            break;
        case 'system':
            broadcastLocal({ type: 'system', payload: data.payload, timestamp: data.emittedAt });
            break;
        case 'profile_updated':
            broadcastLocal({ type: 'profile_updated', payload: data.payload, timestamp });
            break;
        case 'presence_updated':
            broadcastLocal({ type: 'presence_updated', payload: data.payload, timestamp });
            break;
        default:
            break;
    }
}

module.exports = { handleClusterEvent };
