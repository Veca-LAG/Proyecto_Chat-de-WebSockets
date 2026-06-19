'use strict';

const { randomUUID }    = require('crypto');
const pool              = require('../../db/pool');
const { sanitizeText, normalizeNickname } = require('../../utils/sanitize');
const { sendJson }      = require('../../websocket/helpers');
const { publishCluster }= require('../../redis/publisher');
const { users, socketsByUserId } = require('../../websocket/state');
const { logEvent }      = require('../../utils/logger');
const { MAX_NICKNAME_LENGTH } = require('../../config');

const { hashPassword, verifyPassword, validateRegisterPayload } = require('./auth.service');
const {
    generateUserCode,
    findUserById,
    findUserByNickname,
    createSession,
    findUserBySessionToken,
    removeSession
} = require('./auth.repository');
const { getUserModerationPreference } = require('../moderation/moderation.repository');
const { sendInitialState }    = require('../messages/messages.service');
const { rowToProfile, getOrCreateProfile } = require('../profiles/profiles.service');
const {
    toPublicUser,
    markUserOnline,
    markUserOfflineFromThisServer
} = require('../../utils/presence');

// ── Ciclo de vida de conexión ──────────────────────────────────────────────────

async function attachAuthenticatedUser(ws, userRow, sessionToken) {
    await detachSocket(ws, false);

    const wasOfflineLocal  = !socketsByUserId.has(userRow.id);
    const publicUser       = toPublicUser(userRow, true);
    const censorshipEnabled = await getUserModerationPreference(userRow.id);

    ws.preferences = { ...(ws.preferences || {}), censorshipEnabled };
    users.set(ws, publicUser);

    if (!socketsByUserId.has(userRow.id)) socketsByUserId.set(userRow.id, new Set());
    socketsByUserId.get(userRow.id).add(ws);

    const wasOnlineGlobal = await markUserOnline(userRow.id);

    sendJson(ws, {
        type: 'auth_success',
        payload: { sessionToken, user: publicUser, censorshipEnabled },
        timestamp: new Date().toISOString()
    });

    await sendInitialState(ws, publicUser);

    try {
        const profileRow = await getOrCreateProfile(userRow.id, userRow.nickname);
        sendJson(ws, { type: 'my_profile', payload: rowToProfile(profileRow, userRow.nickname), timestamp: new Date().toISOString() });
    } catch (_) { /* no bloquear auth si falla el perfil */ }

    if (wasOfflineLocal) logEvent(`${userRow.nickname} conectado`);

    if (!wasOnlineGlobal) {
        await publishCluster({ event: 'system', payload: { text: `${userRow.nickname} se ha conectado 🟢` } });
    }
    await publishCluster({ event: 'presence_update' });
    await publishCluster({ event: 'group_lists_update' });
}

async function detachSocket(ws, notify = true) {
    const user = users.get(ws);
    if (!user) return;

    users.delete(ws);
    const sockets = socketsByUserId.get(user.id);
    if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
            socketsByUserId.delete(user.id);
            const remainingGlobalConnections = await markUserOfflineFromThisServer(user.id);
            if (notify) {
                if (remainingGlobalConnections === 0) {
                    await publishCluster({ event: 'system', payload: { text: `${user.nickname} se ha desconectado 🔴` } });
                }
                await publishCluster({ event: 'presence_update' });
                await publishCluster({ event: 'group_lists_update' });
                logEvent(`${user.nickname} desconectado`);
            }
        }
    }
}

// ── Handlers de WebSocket ─────────────────────────────────────────────────────

async function handleRegister(ws, payload) {
    const validation = validateRegisterPayload(payload);
    if (!validation.valid) {
        sendJson(ws, { type: 'auth_error', payload: { text: validation.error }, timestamp: new Date().toISOString() });
        return;
    }

    const { firstName, lastName, nickname, password } = validation.data;
    const existing = await findUserByNickname(nickname);
    if (existing) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'Ese nickname ya está registrado. Usa otro o inicia sesión.' }, timestamp: new Date().toISOString() });
        return;
    }

    const { salt, hash } = hashPassword(password);
    const now  = new Date().toISOString();
    const user = {
        id:           randomUUID(),
        code:         await generateUserCode(),
        firstName,
        lastName,
        nickname,
        passwordSalt: salt,
        passwordHash: hash,
        createdAt:    now,
        updatedAt:    now
    };

    await pool.query(
        `INSERT INTO users(id, code, first_name, last_name, nickname, nickname_normalized, password_salt, password_hash, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [user.id, user.code, user.firstName, user.lastName, user.nickname, normalizeNickname(user.nickname),
         user.passwordSalt, user.passwordHash, user.createdAt, user.updatedAt]
    );

    const token = await createSession(user.id);
    await attachAuthenticatedUser(ws, {
        id:            user.id,
        code:          user.code,
        first_name:    user.firstName,
        last_name:     user.lastName,
        nickname:      user.nickname,
        password_salt: user.passwordSalt,
        password_hash: user.passwordHash
    }, token);
}

async function handleLogin(ws, payload) {
    const nickname = sanitizeText(payload.nickname, MAX_NICKNAME_LENGTH);
    const password = String(payload.password || '');

    if (!nickname || !password) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'Ingresa nickname y contraseña.' }, timestamp: new Date().toISOString() });
        return;
    }

    const user = await findUserByNickname(nickname);
    if (!user) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'No existe una cuenta registrada con ese nickname.' }, timestamp: new Date().toISOString() });
        return;
    }

    const userForVerify = { passwordSalt: user.password_salt, passwordHash: user.password_hash };
    if (!verifyPassword(password, userForVerify)) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'La contraseña es incorrecta.' }, timestamp: new Date().toISOString() });
        return;
    }

    const token = await createSession(user.id);
    await attachAuthenticatedUser(ws, user, token);
}

async function handleResume(ws, payload) {
    const user = await findUserBySessionToken(payload.sessionToken);
    if (!user) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'La sesión expiró. Inicia sesión nuevamente.' }, timestamp: new Date().toISOString() });
        return;
    }
    await attachAuthenticatedUser(ws, user, sanitizeText(payload.sessionToken, 200));
}

async function handleLogout(ws, payload) {
    await removeSession(payload.sessionToken);
    await detachSocket(ws, true);
    sendJson(ws, { type: 'logout_success', payload: {}, timestamp: new Date().toISOString() });
}

module.exports = {
    attachAuthenticatedUser,
    detachSocket,
    handleRegister,
    handleLogin,
    handleResume,
    handleLogout
};
