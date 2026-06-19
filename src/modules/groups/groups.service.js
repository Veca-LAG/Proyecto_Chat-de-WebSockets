'use strict';

const pool = require('../../db/pool');
const { sendJson, getSocketsForUser } = require('../../websocket/helpers');
const { clientWantsCensorship } = require('../moderation/moderation.service');
const { getGroupsForUser } = require('../messages/messages.service');
const { users } = require('../../websocket/state');

async function getGroupRole(groupId, userId) {
    const result = await pool.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
    );
    return result.rows[0]?.role || null;
}

async function broadcastGroupListsLocal() {
    for (const [client, user] of users.entries()) {
        sendJson(client, {
            type: 'group_list',
            payload: { groups: await getGroupsForUser(user.id, clientWantsCensorship(client)) },
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = { getGroupRole, broadcastGroupListsLocal };
