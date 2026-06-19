'use strict';

const WebSocket = require('ws');
const pool      = require('../../db/pool');
const { logEvent } = require('../../utils/logger');
const { getWss, sendJson, getSocketsForUser } = require('../../websocket/helpers');
const {
    normalizeTerms,
    fallbackModerationTerms,
    compileModerationRegexList
} = require('./moderation.filter');

let moderationCache = {
    version:  0,
    loadedAt: null,
    terms:    [],
    regexList: []
};

async function loadModerationTerms() {
    try {
        const result = await pool.query(`
            SELECT term, normalized_term, country_code, severity, category, source
            FROM moderation_terms
            WHERE active = TRUE
            ORDER BY LENGTH(normalized_term) DESC, term ASC
        `);
        const terms       = normalizeTerms(result.rows);
        const activeTerms = terms.length ? terms : fallbackModerationTerms();
        moderationCache = {
            version:  moderationCache.version + 1,
            loadedAt: new Date(),
            terms:    activeTerms,
            regexList: compileModerationRegexList(activeTerms)
        };
        logEvent(`Moderación cargada: ${moderationCache.terms.length} términos activos.`);
        return moderationCache;
    } catch (error) {
        const activeTerms = fallbackModerationTerms();
        moderationCache = {
            version:  moderationCache.version + 1,
            loadedAt: new Date(),
            terms:    activeTerms,
            regexList: compileModerationRegexList(activeTerms)
        };
        console.warn('No se pudo cargar moderation_terms desde PostgreSQL. Usando lista mínima:', error.message);
        return moderationCache;
    }
}

function censorText(originalText) {
    const original = String(originalText || '');
    let censoredText = original;
    const matchedTerms = [];

    if (!moderationCache || !Array.isArray(moderationCache.regexList)) {
        return { originalText: original, censoredText, matchedTerms };
    }

    for (const item of moderationCache.regexList) {
        if (!item.regex) continue;
        item.regex.lastIndex = 0;
        if (item.regex.test(censoredText)) {
            matchedTerms.push(item.term);
            item.regex.lastIndex = 0;
            censoredText = censoredText.replace(item.regex, (fullMatch, prefix, badWord) => {
                return `${prefix}${'*'.repeat(badWord.length)}`;
            });
        }
    }

    return { originalText: original, censoredText, matchedTerms };
}

function moderateMessageText(originalText) {
    const result = censorText(originalText);
    return {
        textOriginal: result.originalText,
        textCensored: result.censoredText,
        matchedTerms: result.matchedTerms
    };
}

function censorMessageText(originalText) {
    return moderateMessageText(originalText).textCensored;
}

function clientWantsCensorship(ws) {
    return ws.preferences?.censorshipEnabled !== false;
}

function buildPayloadForClient(payload, ws) {
    const wantsCensored = clientWantsCensorship(ws);
    const text = wantsCensored
        ? (payload.textCensored ?? payload.text ?? '')
        : (payload.textOriginal ?? payload.text ?? '');
    const { textOriginal, textCensored, ...safePayload } = payload;
    return { ...safePayload, text };
}

function sendMessageToClient(ws, type, payload, timestamp) {
    sendJson(ws, { type, payload: buildPayloadForClient(payload, ws), timestamp });
}

function broadcastMessageLocal(type, payload, timestamp, excludeConnectionId = null) {
    const wss = getWss();
    if (!wss) return;
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.connectionId !== excludeConnectionId) {
            sendMessageToClient(client, type, payload, timestamp);
        }
    });
}

function sendMessageToLocalUser(userId, type, payload, timestamp, excludeConnectionId = null) {
    getSocketsForUser(userId).forEach((client) => {
        if (client.connectionId !== excludeConnectionId) {
            sendMessageToClient(client, type, payload, timestamp);
        }
    });
}

module.exports = {
    loadModerationTerms,
    censorText,
    moderateMessageText,
    censorMessageText,
    clientWantsCensorship,
    buildPayloadForClient,
    sendMessageToClient,
    broadcastMessageLocal,
    sendMessageToLocalUser
};
