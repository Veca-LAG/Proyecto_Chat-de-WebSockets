'use strict';

const { redis } = require('./clients');
const { REDIS_CHANNEL } = require('../config');

async function publishCluster(event) {
    await redis.publish(
        REDIS_CHANNEL,
        JSON.stringify({ ...event, emittedAt: new Date().toISOString() })
    );
}

module.exports = { publishCluster };
