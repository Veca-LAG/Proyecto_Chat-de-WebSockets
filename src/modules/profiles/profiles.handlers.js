'use strict';

const pool              = require('../../db/pool');
const { sanitizeText }  = require('../../utils/sanitize');
const { sendJson, broadcastLocal } = require('../../websocket/helpers');
const { publishCluster }= require('../../redis/publisher');
const { users }         = require('../../websocket/state');
const { logEvent }      = require('../../utils/logger');
const { MAX_NICKNAME_LENGTH } = require('../../config');
const { MAX_AVATAR_BYTES, VALID_PRESENCE, rowToProfile, getOrCreateProfile } = require('./profiles.service');
const { findUserById } = require('../auth/auth.repository');

async function handleGetMyProfile(ws) {
    const user = users.get(ws);
    if (!user?.id) return;
    const row = await getOrCreateProfile(user.id, user.nickname);
    sendJson(ws, { type: 'my_profile', payload: rowToProfile(row, user.nickname), timestamp: new Date().toISOString() });
}

async function handleGetUserProfile(ws, payload) {
    const userId  = sanitizeText(payload.userId || '', 80);
    if (!userId) return;
    const userRow = await findUserById(userId);
    if (!userRow) return;
    const row = await getOrCreateProfile(userId, userRow.nickname);
    sendJson(ws, { type: 'user_profile', payload: rowToProfile(row, userRow.nickname), timestamp: new Date().toISOString() });
}

async function handleUpdateProfile(ws, payload) {
    const user = users.get(ws);
    if (!user?.id) return;

    const displayName    = sanitizeText(payload.displayName    || user.nickname, 40) || user.nickname;
    const bio            = sanitizeText(payload.bio            || '', 190);
    const pronouns       = sanitizeText(payload.pronouns       || '', 40);
    const customStatus   = sanitizeText(payload.customStatus   || '', 80);
    const statusEmoji    = sanitizeText(payload.statusEmoji    || '', 10);
    const profileEffect  = sanitizeText(payload.profileEffect  || '', 40);
    const nameplateColor = sanitizeText(payload.nameplateColor || '', 20);
    const bannerRaw      = String(payload.bannerColor || '#fbbf24');
    const bannerColor    = /^#[0-9a-fA-F]{6}$/.test(bannerRaw) ? bannerRaw : '#fbbf24';

    let avatarData = undefined;
    if (payload.avatarData === null) {
        avatarData = null;
    } else if (typeof payload.avatarData === 'string' && payload.avatarData.startsWith('data:image/')) {
        if (payload.avatarData.length > MAX_AVATAR_BYTES) {
            sendJson(ws, { type: 'profile_error', payload: { text: 'El avatar es demasiado grande. Máximo 300 KB.' }, timestamp: new Date().toISOString() });
            return;
        }
        avatarData = payload.avatarData;
    }

    if (avatarData !== undefined) {
        await pool.query(
            `INSERT INTO user_profiles(user_id,username,display_name,bio,pronouns,custom_status,status_emoji,profile_effect,nameplate_color,banner_color,avatar_data,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                display_name=EXCLUDED.display_name, bio=EXCLUDED.bio, pronouns=EXCLUDED.pronouns,
                custom_status=EXCLUDED.custom_status, status_emoji=EXCLUDED.status_emoji,
                profile_effect=EXCLUDED.profile_effect, nameplate_color=EXCLUDED.nameplate_color,
                banner_color=EXCLUDED.banner_color, avatar_data=EXCLUDED.avatar_data, updated_at=NOW()`,
            [user.id, user.nickname, displayName, bio, pronouns, customStatus, statusEmoji, profileEffect, nameplateColor, bannerColor, avatarData]
        );
    } else {
        await pool.query(
            `INSERT INTO user_profiles(user_id,username,display_name,bio,pronouns,custom_status,status_emoji,profile_effect,nameplate_color,banner_color,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                display_name=EXCLUDED.display_name, bio=EXCLUDED.bio, pronouns=EXCLUDED.pronouns,
                custom_status=EXCLUDED.custom_status, status_emoji=EXCLUDED.status_emoji,
                profile_effect=EXCLUDED.profile_effect, nameplate_color=EXCLUDED.nameplate_color,
                banner_color=EXCLUDED.banner_color, updated_at=NOW()`,
            [user.id, user.nickname, displayName, bio, pronouns, customStatus, statusEmoji, profileEffect, nameplateColor, bannerColor]
        );
    }

    const row     = (await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [user.id])).rows[0];
    const profile = rowToProfile(row, user.nickname);
    const ts      = new Date().toISOString();

    sendJson(ws, { type: 'my_profile', payload: profile, timestamp: ts });
    broadcastLocal({ type: 'profile_updated', payload: profile, timestamp: ts });
    await publishCluster({ event: 'profile_updated', payload: profile });
    logEvent(`Perfil actualizado: ${user.nickname}`);
}

async function handleUpdatePresenceStatus(ws, payload) {
    const user = users.get(ws);
    if (!user?.id) return;

    const presenceStatus = VALID_PRESENCE.includes(payload.presenceStatus) ? payload.presenceStatus : 'online';

    await pool.query(
        `INSERT INTO user_profiles(user_id,username,presence_status,updated_at)
         VALUES($1,$2,$3,NOW())
         ON CONFLICT (user_id) DO UPDATE SET presence_status=EXCLUDED.presence_status, updated_at=NOW()`,
        [user.id, user.nickname, presenceStatus]
    );

    const presencePayload = { userId: user.id, presenceStatus, updatedAt: new Date().toISOString() };
    const ts = new Date().toISOString();

    broadcastLocal({ type: 'presence_updated', payload: presencePayload, timestamp: ts });
    await publishCluster({ event: 'presence_updated', payload: presencePayload });
}

async function handleUpdateCustomStatus(ws, payload) {
    const user = users.get(ws);
    if (!user?.id) return;

    const customStatus = sanitizeText(payload.customStatus || '', 80);
    const statusEmoji  = sanitizeText(payload.statusEmoji  || '', 10);

    await pool.query(
        `INSERT INTO user_profiles(user_id,username,custom_status,status_emoji,updated_at)
         VALUES($1,$2,$3,$4,NOW())
         ON CONFLICT (user_id) DO UPDATE SET custom_status=EXCLUDED.custom_status, status_emoji=EXCLUDED.status_emoji, updated_at=NOW()`,
        [user.id, user.nickname, customStatus, statusEmoji]
    );

    const row     = (await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [user.id])).rows[0];
    const profile = rowToProfile(row, user.nickname);
    const ts      = new Date().toISOString();

    sendJson(ws, { type: 'my_profile', payload: profile, timestamp: ts });
    broadcastLocal({ type: 'profile_updated', payload: profile, timestamp: ts });
    await publishCluster({ event: 'profile_updated', payload: profile });
}

module.exports = {
    handleGetMyProfile,
    handleGetUserProfile,
    handleUpdateProfile,
    handleUpdatePresenceStatus,
    handleUpdateCustomStatus
};
