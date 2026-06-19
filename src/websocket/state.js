'use strict';

// Shared in-memory state for this server instance.
// users:         ws → publicUser  (authenticated connections only)
// socketsByUserId: userId → Set<WebSocket> (multiple tabs/devices support)
const users          = new Map();
const socketsByUserId = new Map();

module.exports = { users, socketsByUserId };
