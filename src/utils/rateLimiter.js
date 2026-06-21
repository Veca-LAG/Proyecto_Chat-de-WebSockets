'use strict';

const RATE_WINDOW_MS  = 10_000;
const RATE_MAX_EVENTS = 40;

function checkRateLimit(ws) {
    const now = Date.now();
    if (!ws.rateLimit) {
        ws.rateLimit = { windowStart: now, count: 1 };
        return true;
    }

    if (now - ws.rateLimit.windowStart > RATE_WINDOW_MS) {
        ws.rateLimit.windowStart = now;
        ws.rateLimit.count       = 1;
        return true;
    }

    ws.rateLimit.count++;
    return ws.rateLimit.count <= RATE_MAX_EVENTS;
}

function isRateLimited(ws) {
    return !checkRateLimit(ws);
}

module.exports = { checkRateLimit, isRateLimited, RATE_WINDOW_MS, RATE_MAX_EVENTS };
