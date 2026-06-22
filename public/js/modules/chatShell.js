import { state, elements, SECTION_CONFIG } from '../state.js';
import { getInitials } from '../shared/utils.js';
import { clearTypingIndicator } from './typing.js';
import { getActiveUserByNickname, getKnownUserByNickname, ensurePrivateConversation } from './chatSelect.js';
import { sendJson } from '../socket.js';
import { getProfile, getProfileByNickname, renderAvatarContent, PRESENCE_CONFIG } from './profile.js';

export function renderActiveChatShell() {
    clearTypingIndicator(elements.typingIndicator);

    if (!state.activeChat) {
        const config = SECTION_CONFIG[state.activeSection];
        elements.chatAvatar.textContent = config.avatar;
        elements.chatTitle.textContent = state.activeSection === 'global'
            ? 'Selecciona Foro Global' : 'Selecciona una conversación';
        elements.chatSubtitle.textContent = '';
        elements.profileAvatar.textContent = config.avatar;
        elements.profileName.textContent = 'Sin conversación';
        if (elements.profileUsername) elements.profileUsername.textContent = '';
        elements.profileStatus.textContent = 'Selecciona un chat';
        elements.profileStatus.style.color = '';
        elements.profileDescription.textContent = '';
        elements.profileExtra.innerHTML = '';
        return;
    }

    if (state.activeChat.type === 'global') {
        elements.chatAvatar.textContent = '#';
        elements.chatTitle.textContent = 'Foro Global';
        elements.chatSubtitle.textContent = 'Todos los usuarios conectados pueden leer y enviar mensajes.';
        elements.profileAvatar.textContent = '#';
        elements.profileName.textContent = 'Foro Global';
        if (elements.profileUsername) elements.profileUsername.textContent = '';
        elements.profileStatus.textContent = `● ${state.users.length} usuario(s) activo(s)`;
        elements.profileStatus.style.color = '';
        elements.profileDescription.textContent = 'Canal público en tiempo real. El historial del servidor conserva los últimos 300 mensajes globales.';
        renderProfileUsers();
        return;
    }

    if (state.activeChat.type === 'private') {
        const activeUser = getActiveUserByNickname(state.activeChat.name);
        const knownUser = getKnownUserByNickname(state.activeChat.name);
        const profile = getProfile(activeUser?.id) || getProfileByNickname(state.activeChat.name);
        const displayName = profile?.displayName || state.activeChat.name;
        const presenceStatus = activeUser ? (profile?.presenceStatus || 'online') : 'offline';
        const presenceCfg = PRESENCE_CONFIG[presenceStatus];

        // ── Header del chat ──────────────────────────────────────────────
        elements.chatAvatar.textContent = getInitials(state.activeChat.name);
        elements.chatTitle.textContent = displayName;
        elements.chatSubtitle.textContent = activeUser
            ? `Chat privado · ${(presenceCfg?.label ?? 'En línea').toLowerCase()}`
            : 'Chat privado · desconectado';

        // ── Banner del panel de perfil ───────────────────────────────────
        const bannerEl = document.querySelector('.profile-panel .profile-banner');
        if (bannerEl) bannerEl.style.background = profile?.bannerColor || '';

        // ── Avatar (con foto si existe) ──────────────────────────────────
        renderAvatarContent(elements.profileAvatar, profile || { displayName: state.activeChat.name });

        // ── Nombre, @usuario y estado ────────────────────────────────────
        elements.profileName.textContent = displayName;
        if (elements.profileUsername) {
            elements.profileUsername.textContent = '@' + (profile?.username || state.activeChat.name);
        }
        elements.profileStatus.textContent = activeUser
            ? `${presenceCfg?.icon ?? '●'} ${presenceCfg?.label ?? 'En línea'}`
            : '○ Desconectado';
        elements.profileStatus.style.color = activeUser
            ? `var(--presence-${presenceStatus}, var(--presence-online))`
            : 'var(--text-muted)';

        // ── Bio (con fallback al nombre real) ────────────────────────────
        const fullName = [knownUser?.firstName, knownUser?.lastName].filter(Boolean).join(' ');
        elements.profileDescription.textContent = profile?.bio || fullName || '';

        // ── Extra: pronombres y estado personalizado ─────────────────────
        elements.profileExtra.innerHTML = '';
        if (profile?.pronouns) {
            const pr = document.createElement('p');
            pr.className = 'profile-extra-item';
            pr.textContent = profile.pronouns;
            elements.profileExtra.appendChild(pr);
        }
        if (profile?.customStatus) {
            const cs = document.createElement('p');
            cs.className = 'profile-extra-item';
            cs.textContent = (profile.statusEmoji ? profile.statusEmoji + ' ' : '') + profile.customStatus;
            elements.profileExtra.appendChild(cs);
        }

        // Solicitar perfil al servidor si no está en caché
        if (!profile && activeUser?.id) {
            sendJson({ type: 'get_user_profile', payload: { userId: activeUser.id }, timestamp: new Date().toISOString() });
        }

        return;
    }

    const group = state.groups.find((g) => g.id === state.activeChat.id);
    elements.chatAvatar.textContent = '#';
    elements.chatTitle.textContent = state.activeChat.name;
    elements.chatSubtitle.textContent = `${group?.members?.length || 0} miembro(s) en la comunidad`;
    elements.profileAvatar.textContent = '#';
    elements.profileName.textContent = state.activeChat.name;
    if (elements.profileUsername) elements.profileUsername.textContent = '';
    elements.profileStatus.textContent = 'Comunidad privada';
    elements.profileStatus.style.color = '';
    elements.profileDescription.textContent = 'Los mensajes enviados aquí solo son visibles para miembros del grupo.';
    renderProfileGroupMembers(group);
}

export function renderProfileUsers() {
    elements.profileExtra.innerHTML = '';
    if (elements.profileStatus) {
        elements.profileStatus.textContent = `${state.users.length} usuarios activos`;
    }
    const title = document.createElement('h3');
    title.textContent = 'Activos ahora';
    const list = document.createElement('ul');
    state.users.forEach((user) => {
        const item = document.createElement('li');
        item.textContent = `● ${user.nickname}${user.id === state.selfId ? ' (Tú)' : ''}`;
        list.appendChild(item);
    });
    elements.profileExtra.append(title, list);
}

export function renderProfileGroupMembers(group) {
    elements.profileExtra.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Miembros';
    const list = document.createElement('ul');

    const selfMember = (group?.members || []).find((m) => m.id === state.selfId);
    const selfRole = selfMember?.role || group?.selfRole || (group?.createdBy === state.selfId ? 'owner' : 'member');
    const canPromote = selfRole === 'owner';
    const canAdminGroup = selfRole === 'owner' || selfRole === 'admin';

    (group?.members || []).forEach((member) => {
        const item = document.createElement('li');
        item.className = 'group-member-row';
        const name = document.createElement('span');
        const role = member.role || (member.id === group?.createdBy ? 'owner' : 'member');
        const roleLabel = role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Miembro';
        name.textContent = `${member.nickname}${member.id === state.selfId ? ' (Tú)' : ''} · ${roleLabel}`;
        item.appendChild(name);

        if (canPromote && member.id !== state.selfId && role !== 'admin' && role !== 'owner') {
            const promoteBtn = document.createElement('button');
            promoteBtn.type = 'button';
            promoteBtn.className = 'group-mini-action';
            promoteBtn.textContent = 'Hacer admin';
            promoteBtn.addEventListener('click', () => sendJson({
                type: 'promote_group_admin',
                payload: { groupId: group.id, targetUserId: member.id },
                timestamp: new Date().toISOString()
            }));
            item.appendChild(promoteBtn);
        }
        list.appendChild(item);
    });

    const actions = document.createElement('div');
    actions.className = 'group-action-buttons';

    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'secondary-button'; addBtn.textContent = '➕ Agregar miembros';
    addBtn.addEventListener('click', () => import('./groups.js').then(({ openAddMembersModal }) => openAddMembersModal(group)));

    const inviteBtn = document.createElement('button');
    inviteBtn.type = 'button'; inviteBtn.className = 'secondary-button'; inviteBtn.textContent = '🔗 Enlace de invitación';
    inviteBtn.addEventListener('click', () => import('./groups.js').then(({ requestInviteLink }) => requestInviteLink(group)));

    const leaveBtn = document.createElement('button');
    leaveBtn.type = 'button'; leaveBtn.className = 'secondary-button'; leaveBtn.textContent = '🚪 Salir del grupo';
    leaveBtn.addEventListener('click', () => {
        if (confirm('¿Deseas salir de este grupo?')) {
            sendJson({ type: 'leave_group', payload: { groupId: group.id }, timestamp: new Date().toISOString() });
        }
    });

    const hideBtn = document.createElement('button');
    hideBtn.type = 'button'; hideBtn.className = 'secondary-button'; hideBtn.textContent = '🧹 Eliminar chat';
    hideBtn.addEventListener('click', () => sendJson({
        type: 'hide_group_chat', payload: { groupId: group.id }, timestamp: new Date().toISOString()
    }));

    actions.append(addBtn, inviteBtn, hideBtn, leaveBtn);

    if (canAdminGroup) {
        const deleteGroupBtn = document.createElement('button');
        deleteGroupBtn.type = 'button';
        deleteGroupBtn.className = 'secondary-button danger-button';
        deleteGroupBtn.textContent = '🗑 Eliminar grupo para todos';
        deleteGroupBtn.addEventListener('click', () => {
            if (confirm('Esta acción eliminará el grupo para todos. ¿Continuar?')) {
                sendJson({ type: 'delete_group_everyone', payload: { groupId: group.id }, timestamp: new Date().toISOString() });
            }
        });
        actions.appendChild(deleteGroupBtn);
    }

    elements.profileExtra.append(title, list, actions);
}
