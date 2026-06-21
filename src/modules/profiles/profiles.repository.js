'use strict';

const pool = require('../../db/pool');

async function findProfileByUserId(userId) {
    const result = await pool.query(
        `SELECT * FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]
    );
    return result.rows[0] || null;
}

async function createProfile(userId, displayName, username) {
    await pool.query(
        `INSERT INTO user_profiles(user_id, display_name, username)
         VALUES($1,$2,$3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, displayName, username]
    );
    return findProfileByUserId(userId);
}

async function updateProfile(userId, fields) {
    const allowed = [
        'display_name', 'avatar_url', 'avatar_data', 'banner_color',
        'bio', 'pronouns', 'custom_status', 'presence_status',
        'status_emoji', 'profile_effect', 'nameplate_color'
    ];
    const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
    if (entries.length === 0) return findProfileByUserId(userId);

    const sets   = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);

    const result = await pool.query(
        `UPDATE user_profiles SET ${sets}, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
        [userId, ...values]
    );
    return result.rows[0] || null;
}

async function updatePresenceStatus(userId, presenceStatus) {
    await pool.query(
        `UPDATE user_profiles SET presence_status = $2, updated_at = NOW() WHERE user_id = $1`,
        [userId, presenceStatus]
    );
}

module.exports = {
    findProfileByUserId,
    createProfile,
    updateProfile,
    updatePresenceStatus
};
