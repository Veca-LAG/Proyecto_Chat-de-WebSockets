'use strict';

const path = require('path');

module.exports = {
    HOST:                   process.env.HOST || '0.0.0.0',
    PORT:                   Number(process.env.PORT || 3000),
    SERVER_ID:              process.env.SERVER_ID || `server-${process.env.PORT || 3000}-${process.pid}`,
    PUBLIC_DIR:             path.join(__dirname, '..', 'public'),
    MAX_HISTORY:            Number(process.env.MAX_HISTORY || 300),
    MAX_NICKNAME_LENGTH:    20,
    MAX_NAME_LENGTH:        40,
    MAX_MESSAGE_LENGTH:     Number(process.env.MAX_MESSAGE_LENGTH || 300),
    RATE_LIMIT_WINDOW_MS:   Number(process.env.RATE_LIMIT_WINDOW_MS || 10_000),
    RATE_LIMIT_MAX_MESSAGES:Number(process.env.RATE_LIMIT_MAX_MESSAGES || 30),
    HEARTBEAT_INTERVAL_MS:  Number(process.env.HEARTBEAT_INTERVAL_MS || 30_000),
    MIN_PASSWORD_LENGTH:    6,
    SESSION_DAYS:           30,
    INVITE_SECONDS:         24 * 60 * 60,
    REDIS_CHANNEL:          'chat:events',
    DATABASE_URL:           process.env.DATABASE_URL || 'postgresql://chatuser:chatpass@localhost:5432/chatdb',
    REDIS_URL:              process.env.REDIS_URL    || 'redis://localhost:6379',
    MODERATION_TERMS_SEED_FILE: path.join(__dirname, '..', 'config', 'moderation_terms.seed.json'),
    MODERATION_RELOAD_EVENT: 'moderation_terms_updated',
};
