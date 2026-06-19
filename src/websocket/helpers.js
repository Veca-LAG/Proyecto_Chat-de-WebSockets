'use strict';

const WebSocket = require('ws');
const { users, socketsByUserId } = require('./state');
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_MESSAGES } = require('../config');

// wss is set once during startup via setWss(); all send helpers resolve it lazily.
let _wss = null;
function setWss(wss) { _wss = wss; }
function getWss()    { return _wss; }

function sendJson(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastLocal(data, excludeConnectionId = null) {
    _wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.connectionId !== excludeConnectionId) {
            client.send(JSON.stringify(data));
        }
    });
}

function getSocketsForUser(userId) {
    return socketsByUserId.get(userId) || new Set();
}

function sendToLocalUser(userId, data, excludeConnectionId = null) {
    getSocketsForUser(userId).forEach((client) => {
        if (client.connectionId !== excludeConnectionId) {
            sendJson(client, data);
        }
    });
}

function checkRateLimit(ws) {
    const now = Date.now();
    if (!ws.rateLimit) ws.rateLimit = { windowStart: now, count: 0 };
    if (now - ws.rateLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
        ws.rateLimit.windowStart = now;
        ws.rateLimit.count = 0;
    }
    ws.rateLimit.count += 1;
    return ws.rateLimit.count <= RATE_LIMIT_MAX_MESSAGES;
}

function rejectRateLimited(ws) {
    sendJson(ws, {
        type: 'error',
        payload: { text: 'Estás enviando demasiados mensajes. Espera unos segundos.' },
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    setWss, getWss,
    sendJson, broadcastLocal,
    getSocketsForUser, sendToLocalUser,
    checkRateLimit, rejectRateLimited
};
