'use strict';

const { scryptSync, timingSafeEqual, randomBytes } = require('crypto');
const { sanitizeText } = require('../../utils/sanitize');
const { MAX_NAME_LENGTH, MAX_NICKNAME_LENGTH, MIN_PASSWORD_LENGTH } = require('../../config');

function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, user) {
    if (!user?.passwordSalt || !user?.passwordHash) return false;
    const testHash   = scryptSync(password, user.passwordSalt, 64);
    const storedHash = Buffer.from(user.passwordHash, 'hex');
    if (storedHash.length !== testHash.length) return false;
    return timingSafeEqual(storedHash, testHash);
}

function validateRegisterPayload(payload) {
    const firstName      = sanitizeText(payload.firstName, MAX_NAME_LENGTH);
    const lastName       = sanitizeText(payload.lastName,  MAX_NAME_LENGTH);
    const nickname       = sanitizeText(payload.nickname,  MAX_NICKNAME_LENGTH);
    const password       = String(payload.password || '');
    const passwordConfirm = payload.passwordConfirm === undefined ? password : String(payload.passwordConfirm || '');

    if (!firstName || !lastName || !nickname)
        return { valid: false, data: {}, error: 'Nombre, apellido y nickname son obligatorios.' };
    if (password.length < MIN_PASSWORD_LENGTH)
        return { valid: false, data: {}, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    if (password !== passwordConfirm)
        return { valid: false, data: {}, error: 'Las contraseñas no coinciden.' };

    return { valid: true, data: { firstName, lastName, nickname, password }, error: '' };
}

module.exports = { hashPassword, verifyPassword, validateRegisterPayload };
