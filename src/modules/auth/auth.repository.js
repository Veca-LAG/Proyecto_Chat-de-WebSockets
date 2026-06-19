'use strict';

const { randomUUID, randomBytes } = require('crypto');
const pool = require('../../db/pool');
const { sanitizeText, normalizeNickname } = require('../../utils/sanitize');
const { SESSION_DAYS } = require('../../config');

async function generateUserCode() {
    let code;
    let exists = true;
    while (exists) {
        code   = `USR-${Math.floor(100000 + Math.random() * 900000)}`;
        const result = await pool.query('SELECT 1 FROM users WHERE code = $1 LIMIT 1', [code]);
        exists = result.rowCount > 0;
    }
    return code;
}

async function findUserById(userId) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
    return result.rows[0] || null;
}

async function findUserByNickname(nickname) {
    const result = await pool.query(
        'SELECT * FROM users WHERE nickname_normalized = $1 LIMIT 1',
        [normalizeNickname(nickname)]
    );
    return result.rows[0] || null;
}

async function createSession(userId) {
    const token     = randomBytes(32).toString('hex');
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
    await pool.query(
        'INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES($1,$2,$3,$4)',
        [token, userId, now.toISOString(), expiresAt.toISOString()]
    );
    return token;
}

async function findUserBySessionToken(token) {
    const cleanToken = sanitizeText(token, 200);
    const result = await pool.query(
        `SELECT users.*
         FROM sessions
         INNER JOIN users ON users.id = sessions.user_id
         WHERE sessions.token = $1 AND sessions.expires_at > NOW()
         LIMIT 1`,
        [cleanToken]
    );
    return result.rows[0] || null;
}

async function removeSession(token) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [sanitizeText(token, 200)]);
}

module.exports = {
    generateUserCode,
    findUserById,
    findUserByNickname,
    createSession,
    findUserBySessionToken,
    removeSession
};
