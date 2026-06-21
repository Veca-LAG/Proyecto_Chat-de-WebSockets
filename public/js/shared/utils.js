// Funciones utilitarias puras — sin dependencias de estado ni DOM

export function sanitizeInput(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>?/gm, '')
        .trim()
        .slice(0, maxLength);
}

export function getInitials(value) {
    return String(value || 'U')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'U';
}

export function getPrivateKey(nickname) {
    return sanitizeInput(nickname, 80).toLowerCase();
}

export function formatTime(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(date);
}
