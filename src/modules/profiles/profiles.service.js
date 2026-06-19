'use strict';

const pool             = require('../../db/pool');
const { sanitizeText } = require('../../utils/sanitize');
const { MAX_NICKNAME_LENGTH } = require('../../config');

const MAX_AVATAR_BYTES = 400_000;
const VALID_PRESENCE   = ['online', 'away', 'dnd', 'invisible'];

function rowToProfile(row, fallbackNickname = '') {
    return {
        userId:         row.user_id,
        displayName:    row.display_name   || fallbackNickname,
        username:       row.username       || fallbackNickname,
        avatarUrl:      row.avatar_url     || null,
        avatarData:     row.avatar_data    || null,
        bannerColor:    row.banner_color   || '#fbbf24',
        bio:            row.bio            || '',
        pronouns:       row.pronouns       || '',
        customStatus:   row.custom_status  || '',
        presenceStatus: row.presence_status || 'online',
        statusEmoji:    row.status_emoji   || '',
        profileEffect:  row.profile_effect || '',
        nameplateColor: row.nameplate_color || '',
        updatedAt:      row.updated_at?.toISOString?.() || new Date().toISOString()
    };
}

async function getOrCreateProfile(userId, nickname) {
    let result = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
    if (result.rows[0]) return result.rows[0];

    const nick = sanitizeText(nickname, MAX_NICKNAME_LENGTH);
    await pool.query(
        `INSERT INTO user_profiles(user_id, display_name, username)
         VALUES($1,$2,$3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, nick, nick]
    );
    result = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
    return result.rows[0];
}

module.exports = { MAX_AVATAR_BYTES, VALID_PRESENCE, rowToProfile, getOrCreateProfile };
