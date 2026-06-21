import { state, elements } from '../state.js';
import { sanitizeInput } from '../shared/utils.js';
import { saveLocalState, saveUnreadCounts } from '../shared/storage.js';
import { sendJson } from '../socket.js';
import { renderChatList } from './chatList.js';
import { renderActiveChatMessages } from './messageRender.js';
import { getPrivateKey } from '../shared/utils.js';

export function toggleListMenu() {
    const isHidden = elements.listMenu.classList.toggle('hidden');
    elements.listMenuButton.setAttribute('aria-expanded', String(!isHidden));
}

export function toggleChatMenu() {
    const isHidden = elements.chatMenu.classList.toggle('hidden');
    elements.chatMenuButton.setAttribute('aria-expanded', String(!isHidden));
}

export function closeMenus() {
    elements.listMenu.classList.add('hidden');
    elements.chatMenu.classList.add('hidden');
    elements.listMenuButton.setAttribute('aria-expanded', 'false');
    elements.chatMenuButton.setAttribute('aria-expanded', 'false');
}

export function toggleConversationSearch() {
    const isHidden = elements.conversationSearchBar.classList.toggle('hidden');
    if (!isHidden) {
        elements.conversationSearchInput.focus();
    } else {
        clearConversationSearch();
    }
}

export function clearConversationSearch() {
    elements.conversationSearchInput.value = '';
    elements.conversationSearchBar.classList.add('hidden');
    applyConversationSearch();
}

export function applyConversationSearch() {
    const term = elements.conversationSearchInput.value.trim();
    const nodes = elements.messages.querySelectorAll('.message-content, .system-message');

    nodes.forEach((node) => {
        const raw = node.dataset.rawText || node.textContent || '';
        node.textContent = raw;
        if (!term) return;

        const lowerRaw = raw.toLowerCase();
        const index = lowerRaw.indexOf(term.toLowerCase());
        if (index === -1) return;

        const before = raw.slice(0, index);
        const match = raw.slice(index, index + term.length);
        const after = raw.slice(index + term.length);
        const fragment = document.createDocumentFragment();
        const mark = document.createElement('mark');
        mark.textContent = match;
        fragment.append(document.createTextNode(before), mark, document.createTextNode(after));
        node.innerHTML = '';
        node.appendChild(fragment);
    });
}

export function deleteActiveConversation() {
    closeMenus();
    if (!state.activeChat) return;

    if (!window.confirm('¿Eliminar esta conversación del lado de este navegador?')) return;

    if (state.activeChat.type === 'global') {
        state.globalMessages = [];
    }

    if (state.activeChat.type === 'private') {
        const key = getPrivateKey(state.activeChat.name);
        if (state.privateConversations[key]) {
            state.privateConversations[key].messages = [];
            state.privateConversations[key].updatedAt = new Date().toISOString();
            saveLocalState();
        }
    }

    if (state.activeChat.type === 'group') {
        const groupId = state.activeChat.id;
        sendJson({ type: 'hide_group_chat', payload: { groupId }, timestamp: new Date().toISOString() });
        state.groups = state.groups.filter((g) => g.id !== groupId);
        state.activeChat = null;
    }

    renderChatList();
    renderActiveChatMessages();
}

export function handleDocumentClick(event) {
    const target = event.target;
    const clickedList = elements.listMenu.contains(target) || elements.listMenuButton.contains(target);
    const clickedChat = elements.chatMenu.contains(target) || elements.chatMenuButton.contains(target);
    if (!clickedList && !clickedChat) closeMenus();
}
