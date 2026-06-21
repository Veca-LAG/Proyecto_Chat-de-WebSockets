import { state, elements } from '../state.js';
import { getPrivateKey } from '../shared/utils.js';
import { saveLocalState, saveUnreadCounts } from '../shared/storage.js';
import { markMessageDeletedEverywhere } from './messageActions.js';
import { addEditedTag } from './messageMenu.js';
import { renderChatList } from './chatList.js';
import { renderNavigation } from './navigation.js';
import { renderActiveChatShell, renderProfileGroupMembers } from './chatShell.js';
import { renderActiveChatMessages, renderMessage } from './messageRender.js';
import { ensurePrivateConversation } from './chatSelect.js';
import { updateComposerState } from './auth.js';

export function receivePrivateMessage(payload, timestamp) {
    const isOwn = payload.fromId === state.selfId;
    const counterpart = isOwn ? payload.to : payload.from;
    const conv = ensurePrivateConversation(counterpart);

    const message = {
        id: payload.id,
        from: payload.from,
        fromId: payload.fromId,
        to: payload.to,
        toId: payload.toId,
        text: payload.text,
        timestamp,
        kind: 'private',
        direction: isOwn ? 'out' : 'in'
    };

    const duplicated = conv.messages.some((m) => m.id && payload.id && m.id === payload.id);
    if (!duplicated) {
        conv.messages.push(message);
        conv.messages = conv.messages.slice(-300);
    }
    conv.updatedAt = timestamp || new Date().toISOString();
    saveLocalState();

    const isActiveChat = state.activeChat?.type === 'private' && state.activeChat.name === counterpart;
    if (!isActiveChat && !isOwn) {
        const key = `private:${counterpart}`;
        state.unreadCounts[key] = (state.unreadCounts[key] || 0) + 1;
        saveUnreadCounts();
    }

    renderChatList();
    renderNavigation();
    if (isActiveChat) renderMessage(message);
}

export function receiveGroupMessage(payload, timestamp) {
    const group = state.groups.find((g) => g.id === payload.groupId);
    const message = {
        id: payload.id,
        groupId: payload.groupId,
        groupName: payload.groupName,
        from: payload.from,
        fromId: payload.fromId,
        text: payload.text,
        timestamp,
        kind: 'group',
        replyTo: payload.replyTo || null,
        isForwarded: Boolean(payload.isForwarded),
        forwardedFromId: payload.forwardedFromId || null,
        deletedForAll: Boolean(payload.deletedForAll),
        deletedBy: payload.deletedBy || null,
        reactions: payload.reactions || []
    };

    if (group) {
        group.history = [...(group.history || []), message].slice(-300);
    }

    const isActiveGroup = state.activeChat?.type === 'group' && state.activeChat.id === payload.groupId;
    if (!isActiveGroup && payload.fromId !== state.selfId) {
        const key = `group:${payload.groupId}`;
        state.unreadCounts[key] = (state.unreadCounts[key] || 0) + 1;
        saveUnreadCounts();
    }

    renderChatList();
    renderNavigation();
    if (state.activeChat?.type === 'group' && state.activeChat.id === payload.groupId) {
        renderMessage(message);
        saveUnreadCounts();
    }
}

export function handlePrivateDelete(payload) {
    markMessageDeletedEverywhere(payload?.id, payload?.deletedBy);
}

export function handleGlobalDelete(payload) {
    markMessageDeletedEverywhere(payload?.id, payload?.deletedBy);
}

export function handleGroupDelete(payload) {
    markMessageDeletedEverywhere(payload?.id, payload?.deletedBy);
}

export function handleGroupDeleted(payload) {
    const groupId = payload?.groupId;
    if (!groupId) return;
    state.groups = state.groups.filter((g) => g.id !== groupId);
    if (state.activeChat?.type === 'group' && state.activeChat.id === groupId) {
        state.activeSection = 'communities';
        state.activeChat = null;
        elements.messages.innerHTML = '';
    }
    renderChatList();
    renderActiveChatShell();
}

export function handleMessageEdited(payload) {
    const { id, text } = payload;
    if (!id || !text) return;

    const el = elements.messages.querySelector(`[data-message-id="${id}"]`);
    if (el) {
        const contentEl = el.querySelector('.message-content');
        if (contentEl) { contentEl.textContent = text; contentEl.dataset.rawText = text; }
        addEditedTag(el);
    }

    if (payload.kind === 'global') {
        const msg = state.globalMessages.find((m) => m.id === id);
        if (msg) msg.text = text;
    } else if (payload.kind === 'private') {
        Object.values(state.privateConversations).forEach((conv) => {
            const msg = (conv.messages || []).find((m) => m.id === id);
            if (msg) msg.text = text;
        });
        saveLocalState();
    }
}

export function syncActiveGroup() {
    const group = state.groups.find((g) => g.id === state.activeChat.id);
    if (!group) {
        state.activeChat = null;
        renderActiveChatShell();
        renderActiveChatMessages();
        updateComposerState();
        return;
    }
    state.activeChat.name = group.name;
    renderActiveChatShell();
    renderActiveChatMessages();
}
