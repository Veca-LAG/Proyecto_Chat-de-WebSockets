'use strict';

const { redis }          = require('../redis/clients');
const { publishCluster } = require('../redis/publisher');
const pool               = require('../db/pool');
const { logEvent }       = require('./logger');
const { SERVER_ID }      = require('../config');
const { broadcastLocal } = require('../websocket/helpers');

function toPublicUser(row, online = false) {
    if (!row) return null;
    return {
        id:        row.id,
        code:      row.code,
        firstName: row.first_name  ?? row.firstName,
        lastName:  row.last_name   ?? row.lastName,
        nickname:  row.nickname,
        isOnline:  online
    };
}

async function getOnlineUserIds() {
    const ids = new Set();
    for await (const key of redis.scanIterator({ MATCH: 'presence:user:*', COUNT: 100 })) {
        const onlineServers = await redis.sCard(key);
        if (onlineServers > 0) ids.add(key.replace('presence:user:', ''));
    }
    return Array.from(ids);
}

async function getUserList() {
    const onlineIds = await getOnlineUserIds();
    if (!onlineIds.length) return [];
    const result = await pool.query(
        'SELECT id, code, first_name, last_name, nickname FROM users WHERE id = ANY($1::uuid[]) ORDER BY nickname ASC',
        [onlineIds]
    );
    return result.rows.map((row) => toPublicUser(row, true));
}

async function markUserOnline(userId) {
    const wasOnline = (await redis.sCard(`presence:user:${userId}`)) > 0;
    await redis.sAdd(`presence:user:${userId}`, SERVER_ID);
    return wasOnline;
}

async function markUserOfflineFromThisServer(userId) {
    await redis.sRem(`presence:user:${userId}`, SERVER_ID);
    const remaining = await redis.sCard(`presence:user:${userId}`);
    if (remaining === 0) await redis.del(`presence:user:${userId}`);
    return remaining;
}

async function cleanupServerPresence() {
    for await (const key of redis.scanIterator({ MATCH: 'presence:user:*', COUNT: 100 })) {
        await redis.sRem(key, SERVER_ID);
        const remaining = await redis.sCard(key);
        if (remaining === 0) await redis.del(key);
    }
}

async function broadcastUserListLocal() {
    broadcastLocal({
        type: 'user_list',
        payload: { users: await getUserList() },
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    toPublicUser,
    getOnlineUserIds,
    getUserList,
    markUserOnline,
    markUserOfflineFromThisServer,
    cleanupServerPresence,
    broadcastUserListLocal
};
