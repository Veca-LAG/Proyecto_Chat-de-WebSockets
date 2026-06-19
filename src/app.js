'use strict';

const { randomUUID }     = require('crypto');
const WebSocket          = require('ws');

const { HOST, PORT, HEARTBEAT_INTERVAL_MS, REDIS_CHANNEL } = require('./config');
const { logEvent }       = require('./utils/logger');
const { server }         = require('./http');
const { setWss }         = require('./websocket/helpers');
const { handleSocketMessage } = require('./websocket/router');
const { detachSocket }   = require('./modules/auth/auth.handlers');
const { initDatabase }   = require('./db/schema');
const { redis, subscriber } = require('./redis/clients');
const { publishCluster } = require('./redis/publisher');
const { cleanupServerPresence, markUserOfflineFromThisServer } = require('./utils/presence');
const { loadModerationTerms } = require('./modules/moderation/moderation.service');
const { handleClusterEvent }  = require('./redis/clusterEvents');
const { socketsByUserId } = require('./websocket/state');
const pool               = require('./db/pool');

const wss = new WebSocket.Server({ server });
setWss(wss);

wss.on('connection', (ws) => {
    ws.connectionId  = randomUUID();
    ws.isAlive       = true;
    ws.rateLimit     = { windowStart: Date.now(), count: 0 };
    ws.preferences   = { censorshipEnabled: true };

    logEvent('Cliente WebSocket conectado');
    ws.on('pong',    () => { ws.isAlive = true; });
    ws.on('message', (message) => handleSocketMessage(ws, message));
    ws.on('close',   () => detachSocket(ws, true));
    ws.on('error',   () => detachSocket(ws, true));
});

const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) { ws.terminate(); return; }
        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_INTERVAL_MS);

heartbeatTimer.unref();

async function start() {
    redis.on('error',      (error) => console.error('Redis error:', error));
    subscriber.on('error', (error) => console.error('Redis subscriber error:', error));

    await pool.query('SELECT 1');
    await initDatabase();
    await loadModerationTerms();
    await redis.connect();
    await subscriber.connect();
    await cleanupServerPresence();
    await subscriber.subscribe(REDIS_CHANNEL, handleClusterEvent);

    server.listen(PORT, HOST, () => {
        logEvent(`Servidor WebSocket listo en http://${HOST}:${PORT}`);
    });
}

async function shutdown() {
    logEvent('Cerrando servidor...');
    clearInterval(heartbeatTimer);
    server.close();
    for (const userId of socketsByUserId.keys()) {
        await markUserOfflineFromThisServer(userId);
    }
    await publishCluster({ event: 'presence_update' });
    await subscriber.quit().catch(() => {});
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

module.exports = { start };
