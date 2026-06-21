'use strict';

const { addReaction, removeReaction, getReactionsByMessage } = require('./reactions.repository');
const { publishCluster }  = require('../../redis/publisher');
const { broadcastLocal }   = require('../../websocket/helpers');
const { sendMessageToLocalUser } = require('../moderation/moderation.service');
const { findGroupMemberIds } = require('../groups/groups.repository');

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function isValidEmoji(emoji) {
    return ALLOWED_EMOJIS.includes(emoji);
}

async function toggleReaction(messageId, userId, emoji, action) {
    if (action === 'remove') {
        await removeReaction(messageId, userId);
    } else {
        await addReaction(messageId, userId, emoji);
    }
    return getReactionsByMessage(messageId);
}

async function broadcastReaction({ messageId, emoji, userId, action, kind, groupId, targetId }) {
    const reactions    = await getReactionsByMessage(messageId);
    const reactPayload = { messageId, emoji, userId, action, kind, reactions };

    if (kind === 'global') {
        broadcastLocal({ type: 'message_reaction', payload: reactPayload, timestamp: new Date().toISOString() });
        await publishCluster({ event: 'message_reaction', payload: reactPayload });
    } else if (kind === 'private') {
        const targetIds = [userId, targetId].filter(Boolean);
        const payload = { ...reactPayload, targetIds };
        targetIds.forEach((uid) => sendMessageToLocalUser(uid, 'message_reaction', payload, new Date().toISOString()));
        await publishCluster({ event: 'message_reaction', payload });
    } else if (kind === 'group' && groupId) {
        const memberIds = await findGroupMemberIds(groupId);
        const payload = { ...reactPayload, memberIds };
        memberIds.forEach((uid) => sendMessageToLocalUser(uid, 'message_reaction', payload, new Date().toISOString()));
        await publishCluster({ event: 'message_reaction', payload });
    }
}

module.exports = { ALLOWED_EMOJIS, isValidEmoji, toggleReaction, broadcastReaction };
