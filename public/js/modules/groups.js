import { state, elements, MAX_GROUP_NAME_LENGTH } from '../state.js';
import { sanitizeInput, getInitials } from '../shared/utils.js';
import { sendJson } from '../socket.js';
import { setActiveSection } from './navigation.js';
import { closeMenus } from './search.js';

export function openGroupModal() {
    closeMenus();
    elements.groupError.textContent = '';
    elements.groupNameInput.value = '';
    renderParticipantsList();
    elements.groupModal.classList.remove('hidden');
    elements.groupNameInput.focus();
}

export function closeGroupModal() {
    elements.groupModal.classList.add('hidden');
}

export function renderParticipantsList() {
    elements.participantsList.innerHTML = '';
    const participants = state.users.filter((u) => u.id !== state.selfId);

    if (!participants.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-list-text';
        empty.textContent = 'No hay otros usuarios activos para agregar.';
        elements.participantsList.appendChild(empty);
        return;
    }

    participants.forEach((user) => {
        const label = document.createElement('label');
        label.className = 'participant-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = user.id;
        const avatar = document.createElement('span');
        avatar.className = 'chat-list-avatar';
        avatar.textContent = getInitials(user.nickname);
        const name = document.createElement('span');
        name.textContent = user.nickname;
        label.append(checkbox, avatar, name);
        elements.participantsList.appendChild(label);
    });
}

export function handleGroupSubmit(event) {
    event.preventDefault();
    const name = sanitizeInput(elements.groupNameInput.value, MAX_GROUP_NAME_LENGTH);
    const memberIds = Array.from(
        elements.participantsList.querySelectorAll('input[type="checkbox"]:checked')
    ).map((i) => i.value);

    if (!name) { elements.groupError.textContent = 'El grupo necesita un nombre.'; return; }
    if (!memberIds.length) { elements.groupError.textContent = 'Selecciona al menos un participante activo.'; return; }

    const sent = sendJson({ type: 'create_group', payload: { name, memberIds }, timestamp: new Date().toISOString() });
    if (sent) {
        closeGroupModal();
        setActiveSection('communities', false);
    }
}

export function openAddMembersModal(group) {
    const modal = document.getElementById('addMembersModal');
    const list = document.getElementById('addMembersList');
    const error = document.getElementById('addMembersError');
    error.textContent = '';
    list.innerHTML = '';

    const currentMemberIds = new Set((group.members || []).map((m) => m.id));
    const available = state.users.filter((u) => u.id !== state.selfId && !currentMemberIds.has(u.id));

    if (!available.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-list-text';
        empty.textContent = 'No hay usuarios activos para agregar.';
        list.appendChild(empty);
    } else {
        available.forEach((user) => {
            const label = document.createElement('label');
            label.className = 'participant-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox'; checkbox.value = user.id;
            const avatar = document.createElement('span');
            avatar.className = 'chat-list-avatar'; avatar.textContent = getInitials(user.nickname);
            const name = document.createElement('span'); name.textContent = user.nickname;
            label.append(checkbox, avatar, name);
            list.appendChild(label);
        });
    }

    modal.dataset.groupId = group.id;
    modal.classList.remove('hidden');
}

export function confirmAddMembers() {
    const modal = document.getElementById('addMembersModal');
    const list = document.getElementById('addMembersList');
    const error = document.getElementById('addMembersError');
    const groupId = modal.dataset.groupId;
    const memberIds = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value);

    if (!memberIds.length) { error.textContent = 'Selecciona al menos un usuario.'; return; }
    sendJson({ type: 'add_group_members', payload: { groupId, memberIds }, timestamp: new Date().toISOString() });
    modal.classList.add('hidden');
}

export function requestInviteLink(group) {
    sendJson({ type: 'generate_invite', payload: { groupId: group.id }, timestamp: new Date().toISOString() });
}

export function showInviteLink(payload) {
    const modal = document.getElementById('inviteLinkModal');
    const input = document.getElementById('inviteLinkInput');
    const copied = document.getElementById('inviteLinkCopied');
    copied.style.display = 'none';
    input.value = `${window.location.origin}?invite=${payload.token}`;
    modal.classList.remove('hidden');
}

export function checkInviteToken() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token && state.selfId) {
        sendJson({ type: 'join_by_invite', payload: { token }, timestamp: new Date().toISOString() });
        window.history.replaceState({}, '', window.location.pathname);
    }
}
