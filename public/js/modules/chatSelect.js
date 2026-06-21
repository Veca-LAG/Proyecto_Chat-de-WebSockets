import { state, elements } from '../state.js';
import { getPrivateKey } from '../shared/utils.js';
import { saveLocalState, saveUnreadCounts } from '../shared/storage.js';
import { updateComposerState } from './auth.js';
import { renderNavigation, closeSidebar } from './navigation.js';
import { renderChatList } from './chatList.js';
import { renderActiveChatShell } from './chatShell.js';
import { renderActiveChatMessages } from './messageRender.js';

export function getActiveUserByNickname(nickname) {
    return state.users.find((u) => u.nickname.toLowerCase() === String(nickname || '').toLowerCase());
}

export function getKnownUserByNickname(nickname) {
    const active = getActiveUserByNickname(nickname);
    if (active) return active;
    return state.privateConversations[getPrivateKey(nickname)]?.user;
}

export function ensurePrivateConversation(nickname) {
    const key = getPrivateKey(nickname);
    if (!state.privateConversations[key]) {
        state.privateConversations[key] = {
            nickname,
            messages: [],
            updatedAt: new Date().toISOString()
        };
    }
    return state.privateConversations[key];
}

export function loadPrivateConversationsFromServer(conversations) {
    conversations.forEach((conversation) => {
        const nickname = conversation.user?.nickname;
        if (!nickname) return;
        const local = ensurePrivateConversation(nickname);
        local.user = conversation.user;
        local.messages = (conversation.messages || []).map((m) => ({ ...m, kind: 'private' }));
        local.updatedAt = conversation.updatedAt || local.updatedAt;
    });
    saveLocalState();
}

export function selectGlobalChat() {
    delete state.unreadCounts['global'];
    saveUnreadCounts();
    state.activeSection = 'global';
    state.activeChat = { type: 'global', id: 'global', name: 'Foro Global' };
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
    closeSidebar();
}

export function selectPrivateByUser(user) {
    delete state.unreadCounts[`private:${user.nickname}`];
    saveUnreadCounts();
    ensurePrivateConversation(user.nickname);
    state.activeSection = 'private';
    state.activeChat = { type: 'private', id: user.id, name: user.nickname };
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
    closeSidebar();
    elements.messageInput.focus();
}

export function selectPrivateConversation(nickname) {
    delete state.unreadCounts[`private:${nickname}`];
    saveUnreadCounts();
    const activeUser = getActiveUserByNickname(nickname);
    state.activeChat = { type: 'private', id: activeUser?.id || null, name: nickname };
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
    closeSidebar();
    elements.messageInput.focus();
}

export function selectGroup(group) {
    delete state.unreadCounts[`group:${group.id}`];
    saveUnreadCounts();
    state.activeChat = { type: 'group', id: group.id, name: group.name };
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();
    closeSidebar();
    elements.messageInput.focus();
}
