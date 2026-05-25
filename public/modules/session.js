const SESSION_KEY = 'chat-socket-auth-session-v1';

/**
 * Lee la sesión persistente guardada en este navegador.
 * @returns {{sessionToken:string,user:object}|null} Sesión guardada o null.
 */
export function getStoredSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

/**
 * Guarda la sesión autenticada del usuario actual.
 * @param {{sessionToken:string,user:object}} session Datos de sesión.
 */
export function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Elimina la sesión guardada en este navegador.
 */
export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

/**
 * Indica si una sesión guardada tiene los campos mínimos.
 * @param {object|null} session Sesión a validar.
 * @returns {boolean} True si es válida localmente.
 */
export function hasValidStoredSession(session) {
    return Boolean(session?.sessionToken && session?.user?.id && session?.user?.nickname);
}
