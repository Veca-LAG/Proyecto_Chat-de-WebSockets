'use strict';

const { createClient } = require('redis');
const { REDIS_URL } = require('../config');

const redis      = createClient({ url: REDIS_URL });
const subscriber = redis.duplicate();

module.exports = { redis, subscriber };
