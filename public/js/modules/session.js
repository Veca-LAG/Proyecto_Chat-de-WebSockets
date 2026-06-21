const SESSION_KEY = 'chat-socket-auth-session-v1';

export function getStoredSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

export function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

export function hasValidStoredSession(session) {
    return Boolean(session?.sessionToken && session?.user?.id && session?.user?.nickname);
}
