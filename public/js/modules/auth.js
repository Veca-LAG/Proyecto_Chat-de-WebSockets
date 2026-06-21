import { state, elements } from '../state.js';
import { loadLocalState, loadUnreadCounts } from '../shared/storage.js';
import { saveSession } from './session.js';
import { getProfile, renderAvatarContent, applyPresenceDot } from './profile.js';

export function setAuthMode(mode) {
    state.authMode = mode;
    const isRegister = mode === 'register';

    elements.registerFields.hidden = !isRegister;
    elements.passwordConfirmField.hidden = !isRegister;
    elements.registerFields.classList.toggle('hidden', !isRegister);
    elements.passwordConfirmField.classList.toggle('hidden', !isRegister);
    elements.firstNameInput.required = isRegister;
    elements.lastNameInput.required = isRegister;
    elements.passwordConfirmInput.required = isRegister;

    if (!isRegister) {
        elements.firstNameInput.value = '';
        elements.lastNameInput.value = '';
        elements.passwordConfirmInput.value = '';
    }

    elements.loginModeButton.classList.toggle('auth-tab-active', !isRegister);
    elements.registerModeButton.classList.toggle('auth-tab-active', isRegister);
    elements.loginModeButton.setAttribute('aria-selected', String(!isRegister));
    elements.registerModeButton.setAttribute('aria-selected', String(isRegister));
    elements.passwordInput.autocomplete = isRegister ? 'new-password' : 'current-password';
    elements.passwordInput.placeholder = isRegister ? 'Mínimo 6 caracteres' : 'Ingresa tu contraseña';
    elements.authSubmitButton.textContent = isRegister ? 'Crear cuenta' : 'Entrar al chat';
    elements.loginDescription.textContent = isRegister
        ? 'Crea tu cuenta para usar el chat desde varios dispositivos.'
        : 'Inicia sesión con tu nickname y contraseña.';
    elements.authHelperText.textContent = isRegister
        ? 'Tu código único se generará automáticamente al crear la cuenta.'
        : 'Si la cuenta no existe, usa la opción Crear cuenta.';
    elements.loginError.textContent = '';
}

export function getAuthFormValues() {
    return {
        firstName: elements.firstNameInput.value,
        lastName: elements.lastNameInput.value,
        nickname: elements.nicknameInput.value,
        password: elements.passwordInput.value,
        passwordConfirm: elements.passwordConfirmInput.value
    };
}

export function setAuthLoading(loading) {
    elements.authSubmitButton.disabled = loading;
    elements.authSubmitButton.textContent = loading
        ? 'Validando...'
        : (state.authMode === 'register' ? 'Crear cuenta' : 'Entrar al chat');
}

export function showLogin(message = '') {
    state.shouldReconnect = false;
    setAuthLoading(false);
    elements.loginError.textContent = message;
    elements.loginModal.classList.remove('hidden');
    elements.passwordInput.value = '';
    elements.passwordConfirmInput.value = '';
    elements.nicknameInput.focus();
}

export function setAuthenticatedUser(user, sessionToken) {
    state.sessionToken = sessionToken || state.sessionToken;
    state.selfId = user.id;
    state.nickname = user.nickname;
    state.firstName = user.firstName || '';
    state.lastName = user.lastName || '';
    state.userCode = user.code || '';
    saveSession({ sessionToken: state.sessionToken, user });
    loadLocalState();
    loadUnreadCounts();
    updateSelfIdentity();
}

export function updateConnectionStatus(status) {
    const labels = { connected: 'Conectado', connecting: 'Conectando...', disconnected: 'Desconectado' };
    elements.connectionStatus.textContent = labels[status];
    elements.connectionStatus.className = `connection-status ${status}`;
    updateComposerState();
}

export function updateComposerState() {
    const isConnected = state.socket?.readyState === WebSocket.OPEN;
    const canSend = isConnected && Boolean(state.activeChat) && canSendToActiveChat();

    elements.messageInput.disabled = !canSend;
    elements.sendButton.disabled = !canSend;

    if (!state.activeChat) {
        elements.messageInput.placeholder = 'Selecciona una conversación';
        return;
    }

    elements.messageInput.placeholder = canSend ? 'Escribir mensaje' : 'No se puede enviar en esta conversación';
}

export function canSendToActiveChat() {
    if (!state.activeChat) return false;
    if (state.activeChat.type === 'private') {
        return Boolean(state.users.find(
            (u) => u.nickname.toLowerCase() === String(state.activeChat.name || '').toLowerCase()
        ));
    }
    return true;
}

export function updateSelfIdentity() {
    const profile = state.selfId ? getProfile(state.selfId) : null;
    elements.selfNickname.textContent = profile?.displayName || state.nickname || 'Sin conectar';
    elements.selfCode.textContent = state.userCode || 'Sin código';
    renderAvatarContent(elements.selfAvatar, profile || { displayName: state.nickname });
    const selfDot = document.getElementById('selfPresenceDot');
    if (selfDot) applyPresenceDot(selfDot, profile?.presenceStatus || 'online');
}
