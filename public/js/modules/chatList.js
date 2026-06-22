import { state, elements } from '../state.js';
import { sanitizeInput, getInitials } from '../shared/utils.js';
import { selectPrivateByUser, selectPrivateConversation, selectGroup } from './chatSelect.js';
import { getProfile, getProfileByNickname, PRESENCE_CONFIG } from './profile.js';

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
    const onlineNicknames = new Set(state.users.map(u => u.nickname.toLowerCase()));

    // ── Usuarios conectados (excluir invisibles — aparecen como desconectados) ──
    const users = filterList(state.users, (u) => u.nickname).filter((u) => {
        if (u.id === state.selfId) return true; // siempre mostrarme a mí mismo
        const p = getProfile(u.id);
        return !p || p.presenceStatus !== 'offline'; // 'offline' en caché = invisible para los demás
    });
    users.forEach((user) => {
        const isSelf = user.id === state.selfId;
        const profile = getProfile(user.id);
        const presenceStatus = profile?.presenceStatus || 'online';

        elements.chatList.appendChild(createListItem({
            userId: user.id,
            avatar: getInitials(user.nickname),
            title: `${user.nickname}${isSelf ? ' (Tú)' : ''}`,
            subtitle: isSelf ? 'Tu sesión activa' : (PRESENCE_CONFIG[presenceStatus]?.label ?? 'En línea') + ' · clic para privado',
            presenceStatus,
            active: state.activeChat?.type === 'private' && state.activeChat?.name === user.nickname,
            disabled: isSelf,
            unread: state.unreadCounts[`private:${user.nickname}`] || 0,
            onClick: () => selectPrivateByUser(user)
        }));
    });

    // ── Contactos con conversación previa que están desconectados ──────────
    const offlineConvs = Object.values(state.privateConversations).filter(
        conv => !onlineNicknames.has(conv.nickname?.toLowerCase())
    );
    filterList(offlineConvs, (c) => c.nickname).forEach((conv) => {
        const profile = getProfileByNickname(conv.nickname);
        elements.chatList.appendChild(createListItem({
            userId: profile?.userId ?? null,
            avatar: getInitials(conv.nickname),
            title: conv.nickname,
            subtitle: 'Desconectado',
            presenceStatus: 'offline',
            active: state.activeChat?.type === 'private' && state.activeChat?.name === conv.nickname,
            unread: state.unreadCounts[`private:${conv.nickname}`] || 0,
            onClick: () => selectPrivateConversation(conv.nickname)
        }));
    });
}

function renderPrivateConversationList() {
    const sorted = Object.values(state.privateConversations)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    filterList(sorted, (c) => c.nickname).forEach((conv) => {
        const lastMsg = conv.messages?.at(-1)?.text || '';
        const onlineUser = state.users.find(
            (u) => u.nickname.toLowerCase() === (conv.nickname || '').toLowerCase()
        );
        const profile = onlineUser ? getProfile(onlineUser.id) : getProfileByNickname(conv.nickname);
        const presenceStatus = onlineUser
            ? (profile?.presenceStatus || 'online')
            : 'offline';
        const presenceLabel = PRESENCE_CONFIG[presenceStatus]?.label ?? 'Desconectado';

        elements.chatList.appendChild(createListItem({
            userId: profile?.userId ?? onlineUser?.id ?? null,
            avatar: getInitials(conv.nickname),
            title: conv.nickname,
            subtitle: lastMsg || presenceLabel,
            presenceStatus,
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

export function createListItem({ userId = null, avatar, title, subtitle, presenceStatus = null, active = false, disabled = false, onClick, unread = 0 }) {
    const listItem = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ['chat-list-item', active ? 'chat-list-item-active' : ''].filter(Boolean).join(' ');
    button.disabled = Boolean(disabled);

    // Avatar wrapper — contiene el avatar y el dot de presencia
    const avWrap = document.createElement('div');
    avWrap.className = 'chat-list-av-wrap';
    if (userId) avWrap.dataset.userId = userId;

    const avatarEl = document.createElement('span');
    avatarEl.className = 'chat-list-avatar';
    avatarEl.textContent = avatar;
    avWrap.appendChild(avatarEl);

    // Dot de presencia (solo para usuarios, no grupos/canales)
    if (presenceStatus !== null) {
        const dot = document.createElement('span');
        dot.className = `presence-dot presence-dot--${presenceStatus}`;
        dot.setAttribute('aria-hidden', 'true');
        avWrap.appendChild(dot);
    }

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
        button.append(avWrap, textWrap, badge);
    } else {
        button.append(avWrap, textWrap);
    }

    if (!disabled && typeof onClick === 'function') button.addEventListener('click', onClick);
    listItem.appendChild(button);
    return listItem;
}

export function setupListSearch() {
    elements.userSearchInput.addEventListener('input', renderChatList);
}
