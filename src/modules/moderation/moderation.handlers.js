'use strict';

const { sendJson }      = require('../../websocket/helpers');
const { users }         = require('../../websocket/state');
const { setUserModerationPreference } = require('./moderation.repository');
const { sendInitialState }            = require('../messages/messages.service');

async function handleToggleCensorship(ws, payload) {
    const user    = users.get(ws);
    const enabled = payload.enabled !== false;

    ws.preferences = ws.preferences || { censorshipEnabled: true };
    ws.preferences.censorshipEnabled = enabled;

    if (user?.id) {
        await setUserModerationPreference(user.id, enabled);
    }

    sendJson(ws, {
        type: 'censorship_updated',
        payload: { enabled },
        timestamp: new Date().toISOString()
    });

    if (user?.id) {
        await sendInitialState(ws, user);
    }
}

module.exports = { handleToggleCensorship };
