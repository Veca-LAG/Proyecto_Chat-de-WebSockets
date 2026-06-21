'use strict';

const { MAX_MESSAGE_LENGTH, MAX_NICKNAME_LENGTH } = require('../config');

const NICKNAME_RE = /^[a-zA-Z0-9_\-\.]{3,32}$/;
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidNickname(nickname) {
    return typeof nickname === 'string' && NICKNAME_RE.test(nickname);
}

function isValidUUID(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

function isValidMessageText(text) {
    return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_MESSAGE_LENGTH;
}

function isValidGroupName(name) {
    return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 80;
}

function isValidPresenceStatus(status) {
    return ['online', 'away', 'dnd', 'invisible'].includes(status);
}

function isValidChatType(chatType) {
    return ['global', 'private', 'group'].includes(chatType);
}

function isValidEmoji(emoji) {
    const ALLOWED = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    return typeof emoji === 'string' && ALLOWED.includes(emoji);
}

function isValidReactionAction(action) {
    return action === 'add' || action === 'remove';
}

module.exports = {
    isValidNickname,
    isValidUUID,
    isValidMessageText,
    isValidGroupName,
    isValidPresenceStatus,
    isValidChatType,
    isValidEmoji,
    isValidReactionAction
};
