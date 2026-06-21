import { state, elements } from '../state.js';
import { sanitizeInput, getInitials } from '../shared/utils.js';
import { selectPrivateByUser, selectPrivateConversation, selectGroup } from './chatSelect.js';

export function filterList(items, getText) {
    const term = sanitizeInput(elements.userSearchInput.value, 60).toLowerCase();
    if (!term) return items;
    return items.filter((item) => getText(item).toLowerCase().includes(term));
}

export function renderChatList() {
    elements.chatList.innerHTML = '';
    if (state.activeSection === 'global') { renderGlobalUserList(); return; }
    if (state.activeSection === 'private') { renderPrivateConversationList(); return; }
    renderCommunityList();
}

function renderGlobalUserList() {
    const users = filterList(state.users, (u) => u.nickname);
    users.forEach((user) => {
        const isSelf = user.id === state.selfId;
        elements.chatList.appendChild(createListItem({
            avatar: getInitials(user.nickname),
            title: `${user.nickname}${isSelf ? ' (Tú)' : ''}`,
            subtitle: isSelf ? 'Tu sesión activa' : 'En línea · clic para privado',
            active: state.activeChat?.type === 'private' && state.activeChat?.name === user.nickname,
            disabled: isSelf,
            unread: state.unreadCounts[`private:${user.nickname}`] || 0,
            onClick: () => selectPrivateByUser(user)
        }));
    });
}

function renderPrivateConversationList() {
    const sorted = Object.values(state.privateConversations)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    filterList(sorted, (c) => c.nickname).forEach((conv) => {
        const lastMsg = conv.messages?.at(-1)?.text || '';
        const activeUser = state.users.find(
            (u) => u.nickname.toLowerCase() === conv.nickname.toLowerCase()
        );
        elements.chatList.appendChild(createListItem({
            avatar: getInitials(conv.nickname),
            title: conv.nickname,
            subtitle: lastMsg || (activeUser ? 'En línea' : 'Sin mensajes recientes'),
            active: state.activeChat?.type === 'private' && state.activeChat?.name === conv.nickname,
            unread: state.unreadCounts[`private:${conv.nickname}`] || 0,
            onClick: () => selectPrivateConversation(conv.nickname)
        }));
    });
}

function renderCommunityList() {
    filterList(state.groups, (g) => g.name).forEach((group) => {
        const lastMsg = group.history?.at(-1)?.text || `${group.members?.length || 0} miembros`;
        elements.chatList.appendChild(createListItem({
            avatar: '#',
            title: group.name,
            subtitle: lastMsg,
            active: state.activeChat?.type === 'group' && state.activeChat?.id === group.id,
            unread: state.unreadCounts[`group:${group.id}`] || 0,
            onClick: () => selectGroup(group)
        }));
    });
}

export function createListItem({ avatar, title, subtitle, active = false, disabled = false, onClick, unread = 0 }) {
    const listItem = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ['chat-list-item', active ? 'chat-list-item-active' : ''].filter(Boolean).join(' ');
    button.disabled = Boolean(disabled);

    const avatarEl = document.createElement('span');
    avatarEl.className = 'chat-list-avatar';
    avatarEl.textContent = avatar;

    const textWrap = document.createElement('span');
    textWrap.className = 'chat-list-text';
    const titleEl = document.createElement('strong');
    titleEl.textContent = title;
    const subtitleEl = document.createElement('small');
    subtitleEl.textContent = subtitle || '';
    textWrap.append(titleEl, subtitleEl);

    if (unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'unread-badge';
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.setAttribute('aria-label', `${unread} mensajes sin leer`);
        button.append(avatarEl, textWrap, badge);
    } else {
        button.append(avatarEl, textWrap);
    }

    if (!disabled && typeof onClick === 'function') button.addEventListener('click', onClick);
    listItem.appendChild(button);
    return listItem;
}

export function setupListSearch() {
    elements.userSearchInput.addEventListener('input', renderChatList);
}
