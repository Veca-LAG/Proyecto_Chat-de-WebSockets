const MAX_NAME_LENGTH = 40;
const MAX_NICKNAME_LENGTH = 20;
const MIN_PASSWORD_LENGTH = 6;

export function sanitizeAuthInput(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>?/gm, '')
        .trim()
        .slice(0, maxLength);
}

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

export function validateRegister(values) {
    const firstName = sanitizeAuthInput(values.firstName, MAX_NAME_LENGTH);
    const lastName = sanitizeAuthInput(values.lastName, MAX_NAME_LENGTH);
    const nickname = sanitizeAuthInput(values.nickname, MAX_NICKNAME_LENGTH);
    const password = String(values.password || '');
    const passwordConfirm = String(values.passwordConfirm || '');

    if (!firstName || !lastName || !nickname) {
        return { valid: false, data: {}, error: 'Nombre, apellido y nickname son obligatorios.' };
    }

    const letras = /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+$/;
    const letrasConEspacios = /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+(\s[A-Za-zÁÉÍÓÚáéíóúÑñ]+)*$/;
    if (!letras.test(firstName)) {
        return { valid: false, data: {}, error: 'El nombre solo puede contener letras.' };
    }
    if (!letrasConEspacios.test(lastName)) {
        return { valid: false, data: {}, error: 'El apellido solo puede contener letras y un espacio entre apellidos.' };
    }
    if (firstName.length < 2 || lastName.length < 2) {
        return { valid: false, data: {}, error: 'Nombre y apellido deben tener al menos 2 caracteres.' };
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return { valid: false, data: {}, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    }

    if (!passwordConfirm) {
        return { valid: false, data: {}, error: 'Confirma tu contraseña.' };
    }

    if (password !== passwordConfirm) {
        return { valid: false, data: {}, error: 'Las contraseñas no coinciden.' };
    }

    return { valid: true, data: { firstName, lastName, nickname, password }, error: '' };
}

export function validateNickname(value) {
    const nickname = sanitizeAuthInput(value, MAX_NICKNAME_LENGTH);

    if (!nickname) {
        return { valid: false, nickname: '', error: 'El nickname no puede estar vacío.' };
    }

    return { valid: true, nickname, error: '' };
}
