'use strict';

const { redis } = require('./clients');
const { REDIS_CHANNEL, SERVER_ID } = require('../config');

async function publishCluster(event) {
    await redis.publish(
        REDIS_CHANNEL,
        JSON.stringify({ ...event, originServerId: SERVER_ID, emittedAt: new Date().toISOString() })
    );
}

module.exports = { publishCluster };
