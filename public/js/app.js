// ── Orquestador principal — wires up all modules and boots the app ────────────
import { state, elements, MAX_MESSAGE_LENGTH, MAX_GROUP_NAME_LENGTH } from './state.js';
import { sanitizeInput, getInitials } from './shared/utils.js';
import { loadLocalState, loadUnreadCounts, saveUnreadCounts, saveLocalState } from './shared/storage.js';
import { connectWebSocket, sendJson } from './socket.js';
import { clearSession, getStoredSession, hasValidStoredSession } from './modules/session.js';
import { validateLogin, validateRegister } from './modules/login.js';
import { setupTypingEvents, clearTypingIndicator } from './modules/typing.js';
import { setupEmojiPicker } from './modules/emojiPicker.js';
import { setupModerationUI } from './modules/moderationSettings.js';
import {
    initSoundManager,
    unlockAudio,
    setSoundEnabled,
    isSoundEnabled,
    playOutgoingMessageSound,
} from '../sounds/sound.js';
import { initMessageActions } from './modules/messageActions.js';
import { clearReplyingTo } from './modules/messageReply.js';
import { sendPrivate } from './modules/privateChat.js';
import { openProfileModal, setupProfileModal } from './modules/profileModal.js';
import { openQuickProfile, getProfile } from './modules/profile.js';
import { setupReactionPillClicks } from './modules/reactions.js';

import { setAuthMode, setAuthLoading, getAuthFormValues, setAuthenticatedUser, updateSelfIdentity, updateComposerState } from './modules/auth.js';
import { renderNavigation, setActiveSection, setupNavigation, setupSidebarToggle } from './modules/navigation.js';
import { renderChatList, setupListSearch } from './modules/chatList.js';
import { renderActiveChatShell } from './modules/chatShell.js';
import { renderActiveChatMessages } from './modules/messageRender.js';
import { openGroupModal, closeGroupModal, renderParticipantsList, handleGroupSubmit, confirmAddMembers } from './modules/groups.js';
import { toggleListMenu, toggleChatMenu, closeMenus, toggleConversationSearch, clearConversationSearch, applyConversationSearch, deleteActiveConversation, handleDocumentClick } from './modules/search.js';
import { sendActiveTypingStatus, getActiveTypingContext } from './modules/typingContext.js';

// ── Splash screen ─────────────────────────────────────────────────────────────
(function initSplash() {
    const ANIM_MS = 4000;
    const MAX_MS  = 9000;
    const splash  = document.getElementById('splashScreen');
    if (!splash) return;
    const start = Date.now();
    function dismiss() {
        if (splash.classList.contains('splash-fade-out')) return;
        splash.classList.add('splash-fade-out');
        setTimeout(() => splash.remove(), 650);
    }
    function tryDismiss() {
        const remaining = Math.max(0, ANIM_MS - (Date.now() - start));
        setTimeout(dismiss, remaining);
    }
    if (document.readyState === 'complete') { tryDismiss(); }
    else { window.addEventListener('load', tryDismiss, { once: true }); }
    setTimeout(dismiss, MAX_MS);
})();

// ── Sonido ────────────────────────────────────────────────────────────────────
function setupSoundToggle() {
    const btn    = document.getElementById('soundToggle');
    if (!btn) return;
    const iconOn  = btn.querySelector('.icon-sound-on');
    const iconOff = btn.querySelector('.icon-sound-off');

    const update = (enabled) => {
        if (iconOn)  iconOn.style.display  = enabled ? '' : 'none';
        if (iconOff) iconOff.style.display = enabled ? 'none' : '';
        btn.setAttribute('aria-label', enabled ? 'Silenciar sonidos' : 'Activar sonidos');
        btn.title = enabled ? 'Silenciar sonidos' : 'Activar sonidos';
    };

    update(isSoundEnabled());

    btn.addEventListener('click', () => {
        const next = !isSoundEnabled();
        setSoundEnabled(next);
        update(next);
    });
}

// ── Tema ──────────────────────────────────────────────────────────────────────
function setupThemeToggle() {
    const savedTheme = localStorage.getItem('chat-theme') || 'dark';
    document.body.dataset.theme = savedTheme;
    const railIcon = elements.themeToggle.querySelector('.rail-icon');
    railIcon.querySelector('.icon-sun').style.display  = savedTheme === 'dark' ? '' : 'none';
    railIcon.querySelector('.icon-moon').style.display = savedTheme === 'dark' ? 'none' : '';

    elements.themeToggle.addEventListener('click', () => {
        const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
        document.body.dataset.theme = next;
        localStorage.setItem('chat-theme', next);
        railIcon.querySelector('.icon-sun').style.display  = next === 'dark' ? '' : 'none';
        railIcon.querySelector('.icon-moon').style.display = next === 'dark' ? 'none' : '';
    });
}

// ── Envío de mensaje ──────────────────────────────────────────────────────────
function handleMessageSubmit(event) {
    event.preventDefault();
    const text = sanitizeInput(elements.messageInput.value, MAX_MESSAGE_LENGTH);
    if (!text || !state.activeChat) return;

    const timestamp = new Date().toISOString();
    const replyTo = state.replyingTo || null;

    if (state.activeChat.type === 'global') {
        sendJson({ type: 'message', payload: { text, isForwarded: false, ...(replyTo ? { replyTo, replyToId: replyTo.id } : {}) }, timestamp });
    }

    if (state.activeChat.type === 'private') {
        const activeUser = state.users.find(
            (u) => u.nickname.toLowerCase() === String(state.activeChat.name || '').toLowerCase()
        );
        if (!activeUser) return;
        sendPrivate({ socketSender: sendJson, targetUser: activeUser, text, timestamp, replyTo, isForwarded: false });
    }

    if (state.activeChat.type === 'group') {
        sendJson({
            type: 'group_message',
            payload: { groupId: state.activeChat.id, text, isForwarded: false, ...(replyTo ? { replyTo, replyToId: replyTo.id } : {}) },
            timestamp
        });
    }

    playOutgoingMessageSound();
    clearReplyingTo(state, elements);
    elements.messageInput.value = '';
    clearTypingIndicator(elements.typingIndicator);
    sendActiveTypingStatus(false);
}

// ── Login ─────────────────────────────────────────────────────────────────────
function handleLoginSubmit(event) {
    event.preventDefault();
    const values = getAuthFormValues();
    const validation = state.authMode === 'register'
        ? validateRegister(values)
        : validateLogin(values);

    if (!validation.valid) {
        elements.loginError.textContent = validation.error;
        return;
    }

    elements.loginError.textContent = '';
    setAuthLoading(true);
    unlockAudio();
    connectWebSocket({
        type: state.authMode === 'register' ? 'register' : 'login',
        payload: validation.data
    });
}

// ── Inicialización ────────────────────────────────────────────────────────────
function initApp() {
    initSoundManager();
    document.addEventListener('click',    unlockAudio);
    document.addEventListener('keydown',  unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
    setupThemeToggle();
    setupSoundToggle();
    setupNavigation();
    setupSidebarToggle();
    setupListSearch();
    updateSelfIdentity();
    renderNavigation();
    renderChatList();
    renderActiveChatShell();
    updateComposerState();

    setupEmojiPicker(elements);
    setupReactionPillClicks({ container: elements.messages, state, sendJson });

    initMessageActions({
        state,
        sendJson,
        renderActiveChatMessages,
        applyConversationSearch,
        saveLocalState
    });

    setupTypingEvents({
        input: elements.messageInput,
        sendTyping: sendActiveTypingStatus,
        canSendTyping: () => Boolean(getActiveTypingContext())
    });

    // Password toggle
    document.querySelectorAll('.password-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.for);
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.querySelector('.eye-show').style.display = show ? 'none' : '';
            btn.querySelector('.eye-hide').style.display = show ? '' : 'none';
            btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
        });
    });

    // Auth
    elements.loginModeButton.addEventListener('click', () => setAuthMode('login'));
    elements.registerModeButton.addEventListener('click', () => setAuthMode('register'));
    elements.loginForm.addEventListener('submit', handleLoginSubmit);

    // Logout
    elements.logoutButton.addEventListener('click', () => {
        state.shouldReconnect = false;
        sendJson({ type: 'logout', payload: { sessionToken: state.sessionToken }, timestamp: new Date().toISOString() });
        clearSession();
        window.location.reload();
    });

    // Mensajes
    elements.messageForm.addEventListener('submit', handleMessageSubmit);

    // Menús
    elements.listMenuButton.addEventListener('click', toggleListMenu);
    elements.chatMenuButton.addEventListener('click', toggleChatMenu);

    // Grupos
    elements.openGroupModalButton.addEventListener('click', openGroupModal);
    elements.groupForm.addEventListener('submit', handleGroupSubmit);
    elements.closeGroupModalButton.addEventListener('click', closeGroupModal);
    elements.cancelGroupButton.addEventListener('click', closeGroupModal);

    // Búsqueda de conversación
    elements.conversationSearchButton.addEventListener('click', toggleConversationSearch);
    elements.closeConversationSearch.addEventListener('click', clearConversationSearch);
    elements.conversationSearchInput.addEventListener('input', applyConversationSearch);
    elements.deleteConversationButton.addEventListener('click', deleteActiveConversation);

    // Modals adicionales
    document.getElementById('closeAddMembersButton').addEventListener('click', () => {
        document.getElementById('addMembersModal').classList.add('hidden');
    });
    document.getElementById('cancelAddMembersButton').addEventListener('click', () => {
        document.getElementById('addMembersModal').classList.add('hidden');
    });
    document.getElementById('confirmAddMembersButton').addEventListener('click', confirmAddMembers);
    document.getElementById('closeInviteLinkButton').addEventListener('click', () => {
        document.getElementById('inviteLinkModal').classList.add('hidden');
    });
    document.getElementById('copyInviteLinkButton').addEventListener('click', () => {
        const input = document.getElementById('inviteLinkInput');
        navigator.clipboard.writeText(input.value).then(() => {
            const copied = document.getElementById('inviteLinkCopied');
            copied.style.display = 'block';
            setTimeout(() => { copied.style.display = 'none'; }, 2000);
        });
    });

    // Perfil propio
    document.getElementById('selfProfileButton')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const profile = state.selfId ? getProfile(state.selfId) : null;
        if (!profile) return;
        openQuickProfile(
            profile,
            e.currentTarget,
            () => openProfileModal(getProfile(state.selfId) || profile, sendJson),
            null,
            sendJson
        );
    });

    // Moderación y perfil modal
    setupModerationUI(elements, state, sendJson);
    setupProfileModal(sendJson);

    document.addEventListener('click', handleDocumentClick);

    // Restaurar sesión guardada
    setAuthMode('login');
    const storedSession = getStoredSession();
    if (hasValidStoredSession(storedSession)) {
        state.sessionToken = storedSession.sessionToken;
        const user = storedSession.user;
        state.selfId = user.id;
        state.nickname = user.nickname;
        state.firstName = user.firstName || '';
        state.lastName = user.lastName || '';
        state.userCode = user.code || '';
        updateSelfIdentity();
        loadLocalState();
        loadUnreadCounts();
        state.activeSection = 'global';
        state.activeChat = { type: 'global', id: 'global', name: 'Foro Global' };
        renderNavigation();
        renderChatList();
        renderActiveChatShell();
        updateComposerState();
        setAuthLoading(true);
        connectWebSocket({ type: 'resume', payload: { sessionToken: storedSession.sessionToken } });
    }
}

initApp();
