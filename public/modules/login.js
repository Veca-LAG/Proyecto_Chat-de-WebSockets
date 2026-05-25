const MAX_NAME_LENGTH = 40;
const MAX_NICKNAME_LENGTH = 20;
const MIN_PASSWORD_LENGTH = 6;

/**
 * Sanitiza texto de formularios de autenticación.
 * @param {string} value Valor original.
 * @param {number} maxLength Longitud máxima.
 * @returns {string} Texto seguro.
 */
export function sanitizeAuthInput(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>?/gm, '')
        .trim()
        .slice(0, maxLength);
}

/**
 * Valida datos para iniciar sesión.
 * @param {{nickname:string,password:string}} values Datos del formulario.
 * @returns {{valid:boolean,data:object,error:string}} Resultado.
 */
export function validateLogin(values) {
    const nickname = sanitizeAuthInput(values.nickname, MAX_NICKNAME_LENGTH);
    const password = String(values.password || '');

    if (!nickname) {
        return { valid: false, data: {}, error: 'El nickname no puede estar vacío.' };
    }

    if (!password) {
        return { valid: false, data: {}, error: 'Ingresa tu contraseña.' };
    }

    return { valid: true, data: { nickname, password }, error: '' };
}

/**
 * Valida datos para crear una cuenta.
 * @param {{firstName:string,lastName:string,nickname:string,password:string}} values Datos del formulario.
 * @returns {{valid:boolean,data:object,error:string}} Resultado.
 */
export function validateRegister(values) {
    const firstName = sanitizeAuthInput(values.firstName, MAX_NAME_LENGTH);
    const lastName = sanitizeAuthInput(values.lastName, MAX_NAME_LENGTH);
    const nickname = sanitizeAuthInput(values.nickname, MAX_NICKNAME_LENGTH);
    const password = String(values.password || '');

    if (!firstName || !lastName || !nickname) {
        return { valid: false, data: {}, error: 'Nombre, apellido y nickname son obligatorios.' };
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return { valid: false, data: {}, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    }

    return { valid: true, data: { firstName, lastName, nickname, password }, error: '' };
}

/**
 * Mantiene compatibilidad con versiones anteriores del proyecto.
 * @param {string} value Nickname original.
 * @returns {{valid:boolean,nickname:string,error:string}} Resultado.
 */
export function validateNickname(value) {
    const nickname = sanitizeAuthInput(value, MAX_NICKNAME_LENGTH);

    if (!nickname) {
        return { valid: false, nickname: '', error: 'El nickname no puede estar vacío.' };
    }

    return { valid: true, nickname, error: '' };
}
