import { state, elements } from '../state.js';
import { saveUnreadCounts } from '../shared/storage.js';
// Imports circulares — OK porque las llamadas ocurren dentro de funciones, nunca en top-level
import { closeMenus, clearConversationSearch } from './search.js';
import { renderChatList } from './chatList.js';
import { renderActiveChatShell } from './chatShell.js';
import { renderActiveChatMessages } from './messageRender.js';
import { updateComposerState } from './auth.js';
import { selectGlobalChat } from './chatSelect.js';

const _sidebarBackdrop = document.getElementById('sidebarBackdrop');

export function openSidebar() {
    elements.userSidebar.classList.add('is-open');
    _sidebarBackdrop?.classList.add('is-visible');
}

export function closeSidebar() {
    elements.userSidebar.classList.remove('is-open');
    _sidebarBackdrop?.classList.remove('is-visible');
}

export function renderNavigation() {
    const privateUnread = Object.entries(state.unreadCounts)
        .filter(([key]) => key.startsWith('private:'))
        .reduce((sum, [, count]) => sum + count, 0);

    let privateBadge = elements.navPrivate.querySelector('.rail-unread-badge');
    if (privateUnread > 0) {
        if (!privateBadge) {
            privateBadge = document.createElement('span');
            privateBadge.className = 'rail-unread-badge';
            elements.navPrivate.appendChild(privateBadge);
        }
        privateBadge.textContent = privateUnread > 99 ? '99+' : String(privateUnread);
    } else if (privateBadge) {
        privateBadge.remove();
    }

    const communitiesUnread = Object.entries(state.unreadCounts)
        .filter(([key]) => key.startsWith('group:'))
        .reduce((sum, [, count]) => sum + count, 0);

    let communitiesBadge = elements.navCommunities.querySelector('.rail-unread-badge');
    if (communitiesUnread > 0) {
        if (!communitiesBadge) {
            communitiesBadge = document.createElement('span');
            communitiesBadge.className = 'rail-unread-badge';
            elements.navCommunities.appendChild(communitiesBadge);
        }
        communitiesBadge.textContent = communitiesUnread > 99 ? '99+' : String(communitiesUnread);
    } else if (communitiesBadge) {
        communitiesBadge.remove();
    }

    [elements.navGlobal, elements.navPrivate, elements.navCommunities].forEach((btn) => {
        btn.classList.toggle('rail-item-active', btn.dataset.section === state.activeSection);
    });

    const globalUnread = state.unreadCounts['global'] || 0;
    let railBadge = elements.navGlobal.querySelector('.rail-unread-badge');
    if (globalUnread > 0) {
        if (!railBadge) {
            railBadge = document.createElement('span');
            railBadge.className = 'rail-unread-badge';
            elements.navGlobal.appendChild(railBadge);
        }
        railBadge.textContent = globalUnread > 99 ? '99+' : String(globalUnread);
    } else if (railBadge) {
        railBadge.remove();
    }
}

export function setActiveSection(section, openDefault = true) {
    state.activeSection = section;

    if (section === 'private') {
        Object.keys(state.unreadCounts)
            .filter((key) => key.startsWith('private:'))
            .forEach((key) => delete state.unreadCounts[key]);
        saveUnreadCounts();
    }

    if (section === 'global' && openDefault) {
        state.activeChat = { type: 'global', id: 'global', name: 'Foro Global' };
        saveUnreadCounts();
    } else {
        state.activeChat = null;
    }

    closeMenus();
    clearConversationSearch();
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    renderActiveChatMessages();
    updateComposerState();

    if (window.matchMedia('(max-width: 860px)').matches && section !== 'global') {
        openSidebar();
    }
}

export function setupNavigation() {
    elements.navGlobal.addEventListener('click', selectGlobalChat);
    elements.navPrivate.addEventListener('click', () => setActiveSection('private', false));
    elements.navCommunities.addEventListener('click', () => setActiveSection('communities', false));
}

export function setupSidebarToggle() {
    elements.sidebarToggle.addEventListener('click', () => {
        elements.userSidebar.classList.contains('is-open') ? closeSidebar() : openSidebar();
    });
    _sidebarBackdrop?.addEventListener('click', closeSidebar);
}
