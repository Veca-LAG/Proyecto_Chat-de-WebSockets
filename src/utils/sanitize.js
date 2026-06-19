'use strict';

function sanitizeText(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>?/gm, '')
        .trim()
        .slice(0, maxLength);
}

function normalizeNickname(nickname) {
    return String(nickname || '').trim().toLowerCase();
}

module.exports = { sanitizeText, normalizeNickname };
