'use strict';

const pool = require('../../db/pool');

async function addReaction(messageId, userId, emoji) {
    await pool.query(
        `INSERT INTO message_reactions(message_id, user_id, emoji, created_at)
         VALUES($1,$2,$3,NOW())
         ON CONFLICT(message_id, user_id)
         DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
        [messageId, userId, emoji]
    );
}

async function removeReaction(messageId, userId) {
    await pool.query(
        `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`,
        [messageId, userId]
    );
}

async function getReactionsByMessage(messageId) {
    const result = await pool.query(
        `SELECT emoji, ARRAY_AGG(user_id::text ORDER BY created_at ASC) AS users
         FROM message_reactions
         WHERE message_id = $1
         GROUP BY emoji
         ORDER BY emoji`,
        [messageId]
    );
    return result.rows.map((row) => ({ emoji: row.emoji, users: row.users || [] }));
}

async function deleteReactionsByMessage(messageId) {
    await pool.query(
        `DELETE FROM message_reactions WHERE message_id = $1`, [messageId]
    );
}

module.exports = {
    addReaction,
    removeReaction,
    getReactionsByMessage,
    deleteReactionsByMessage
};
