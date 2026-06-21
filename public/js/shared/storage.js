// Persistencia en localStorage de conversaciones privadas y contadores no leídos
import { state } from '../state.js';

function getStorageKey() {
    return `chat-socket:${state.selfId || state.nickname || 'anonymous'}:frontend-v4`;
}

export function loadLocalState() {
    try {
        const raw = localStorage.getItem(getStorageKey());
        const parsed = raw ? JSON.parse(raw) : {};
        state.privateConversations = parsed.privateConversations || {};
    } catch {
        state.privateConversations = {};
    }
}

export function saveLocalState() {
    localStorage.setItem(getStorageKey(), JSON.stringify({
        privateConversations: state.privateConversations
    }));
}

export function saveUnreadCounts() {
    localStorage.setItem(
        `chat-unread:${state.selfId || state.nickname}`,
        JSON.stringify(state.unreadCounts)
    );
}

export function loadUnreadCounts() {
    try {
        const raw = localStorage.getItem(`chat-unread:${state.selfId || state.nickname}`);
        state.unreadCounts = raw ? JSON.parse(raw) : {};
    } catch {
        state.unreadCounts = {};
    }
}
