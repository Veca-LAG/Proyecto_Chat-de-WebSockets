import { state } from '../state.js';
import { sendJson } from '../socket.js';

export function getActiveTypingContext() {
    if (!state.selfId || !state.activeChat) return null;

    if (state.activeChat.type === 'global') {
        return { chatType: 'global', targetId: 'global', targetName: 'Foro Global' };
    }

    if (state.activeChat.type === 'private') {
        const activeUser = state.users.find(
            (u) => u.nickname.toLowerCase() === String(state.activeChat.name || '').toLowerCase()
        );
        if (!activeUser || activeUser.id === state.selfId) return null;
        return { chatType: 'private', targetId: activeUser.id, targetName: activeUser.nickname };
    }

    if (state.activeChat.type === 'group') {
        return { chatType: 'group', targetId: state.activeChat.id, targetName: state.activeChat.name };
    }

    return null;
}

export function sendActiveTypingStatus(isTyping) {
    const context = getActiveTypingContext();
    if (!context) return false;
    return sendJson({
        type: 'typing',
        payload: { isTyping, ...context },
        timestamp: new Date().toISOString()
    });
}

export function isTypingStatusForActiveChat(payload) {
    if (!payload || !state.activeChat) return false;
    if (state.selfId && payload.fromId === state.selfId) return false;

    if (state.activeChat.type === 'global') return payload.chatType === 'global';

    if (state.activeChat.type === 'private') {
        const sameById = Boolean(state.activeChat.id && payload.fromId === state.activeChat.id);
        const sameByName = payload.nickname?.toLowerCase?.() === state.activeChat.name?.toLowerCase?.();
        return payload.chatType === 'private' && (sameById || sameByName);
    }

    if (state.activeChat.type === 'group') {
        return payload.chatType === 'group' && payload.targetId === state.activeChat.id;
    }

    return false;
}
