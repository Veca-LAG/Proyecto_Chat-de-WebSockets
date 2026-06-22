import { state, elements } from './state.js';
import { updateCensorshipLabel } from './modules/moderationSettings.js';
import { upsertProfile, applyPresenceDot } from './modules/profile.js';
import { handleTypingStatus } from './modules/typing.js';
import { applyIncomingReaction, applyReactionSnapshot } from './modules/reactions.js';
import { showMiniToast } from './modules/messageMenu.js';
import { clearSession } from './modules/session.js';

import { setAuthLoading, setAuthenticatedUser, updateComposerState, updateConnectionStatus, showLogin, updateSelfIdentity } from './modules/auth.js';
import { renderNavigation } from './modules/navigation.js';
import { renderChatList } from './modules/chatList.js';
import { renderActiveChatShell, renderProfileUsers } from './modules/chatShell.js';
import { renderActiveChatMessages, renderMessage, renderSystemMessage } from './modules/messageRender.js';
import { receivePrivateMessage, receiveGroupMessage, handlePrivateDelete, handleGlobalDelete, handleGroupDelete, handleGroupDeleted, handleMessageEdited, syncActiveGroup } from './modules/messageHandlers.js';
import { loadPrivateConversationsFromServer } from './modules/chatSelect.js';
import { checkInviteToken, showInviteLink, renderParticipantsList } from './modules/groups.js';
import { isTypingStatusForActiveChat } from './modules/typingContext.js';
import { saveUnreadCounts } from './shared/storage.js';
import {
    playIncomingMessageSound,
    playMentionSound,
    playSoftErrorSound,
    playReactionSound,
    playUserOnlineSound,
    playUserOfflineSound,
} from '../sounds/sound.js';

export function handleServerMessage(rawMessage) {
    let data;
    try { data = JSON.parse(rawMessage); } catch { return; }

    const { type, payload = {}, timestamp } = data;

    switch (type) {
        case 'auth_success':
            setAuthLoading(false);
            state.censorshipEnabled = payload.censorshipEnabled !== false;
            updateCensorshipLabel(elements.toggleCensorshipButton, state.censorshipEnabled);
            setAuthenticatedUser(payload.user, payload.sessionToken);
            elements.loginModal.classList.add('hidden');
            state.activeSection = 'global';
            state.activeChat = { type: 'global', id: 'global', name: 'Foro Global' };
            renderNavigation();
            renderChatList();
            renderActiveChatShell();
            renderActiveChatMessages();
            updateComposerState();
            checkInviteToken();
            break;

        case 'auth_error':
            setAuthLoading(false);
            clearSession();
            state.sessionToken = '';
            state.shouldReconnect = false;
            if (state.socket?.readyState === WebSocket.OPEN) state.socket.close();
            updateConnectionStatus('disconnected');
            showLogin(payload.text || 'No se pudo iniciar sesión.');
            break;

        case 'logout_success':
            clearSession();
            window.location.reload();
            break;

        case 'private_conversations':
            loadPrivateConversationsFromServer(payload.conversations || []);
            renderChatList();
            if (state.activeChat?.type === 'private') renderActiveChatMessages();
            break;

        case 'invite_link':
            showInviteLink(payload);
            break;

        case 'join_success':
            state.selfId = payload.id;
            state.nickname = payload.nickname || state.nickname;
            updateSelfIdentity();
            renderChatList();
            updateComposerState();
            checkInviteToken();
            playUserOnlineSound();
            break;

        case 'history':
            state.globalMessages = payload.messages || [];
            if (state.activeChat?.type === 'global') renderActiveChatMessages();
            break;

        case 'user_list':
            state.users = payload.users || [];
            renderChatList();
            renderParticipantsList();
            renderProfileUsers();
            updateComposerState();
            break;

        case 'group_list':
            state.groups = payload.groups || [];
            renderChatList();
            if (state.activeChat?.type === 'group') syncActiveGroup();
            break;

        case 'broadcast':
            state.globalMessages.push({ ...payload, timestamp });
            state.globalMessages = state.globalMessages.slice(-300);
            if (state.activeChat?.type === 'global') {
                renderMessage({ ...payload, timestamp, kind: 'global' });
            } else if (payload.fromId !== state.selfId) {
                state.unreadCounts['global'] = (state.unreadCounts['global'] || 0) + 1;
                saveUnreadCounts();
                renderNavigation();
            }
            // Foro global: sin sonido genérico (100+ usuarios sería molesto).
            // Solo se avisa si alguien menciona directamente al usuario.
            if (payload.fromId !== state.selfId && state.nickname) {
                const hasMention = String(payload.text || '').toLowerCase()
                    .includes('@' + state.nickname.toLowerCase());
                if (hasMention) playMentionSound();
            }
            break;

        case 'private_msg':
            receivePrivateMessage(payload, timestamp);
            if (payload.fromId !== state.selfId) playIncomingMessageSound();
            renderNavigation();
            break;

        case 'private_delete':    handlePrivateDelete(payload); break;
        case 'global_delete':     handleGlobalDelete(payload); break;
        case 'group_delete':      handleGroupDelete(payload); break;
        case 'message_edited':    handleMessageEdited(payload); break;

        case 'message_reaction':
            if (Array.isArray(payload.reactions)) {
                applyReactionSnapshot(payload.messageId, payload.reactions, state.selfId);
            } else {
                applyIncomingReaction(payload.messageId, payload.emoji, payload.userId, payload.action, state.selfId);
                if (payload.userId !== state.selfId && payload.action === 'add') {
                    playReactionSound();
                }
            }
            break;

        case 'group_deleted':     handleGroupDeleted(payload); break;

        case 'censorship_updated':
            state.censorshipEnabled = Boolean(payload.enabled);
            updateCensorshipLabel(elements.toggleCensorshipButton, state.censorshipEnabled);
            showMiniToast(state.censorshipEnabled ? 'Censura activada' : 'Censura desactivada');
            break;

        case 'group_msg':
            receiveGroupMessage(payload, timestamp);
            if (payload.fromId !== state.selfId) {
                const hasMention = state.nickname &&
                    String(payload.text || '').toLowerCase()
                        .includes('@' + state.nickname.toLowerCase());
                hasMention ? playMentionSound() : playIncomingMessageSound();
            }
            break;

        case 'private_error':
        case 'group_error':
        case 'error':
            renderSystemMessage(payload.text || 'Ocurrió un error.', timestamp);
            playSoftErrorSound();
            break;

        case 'typing_status':
            if (isTypingStatusForActiveChat(payload)) {
                handleTypingStatus(elements.typingIndicator, payload, state.selfId);
            }
            break;

        case 'system':
            if (state.activeChat?.type === 'global') {
                renderSystemMessage(payload.text || 'Evento del sistema', timestamp);
            }
            break;

        case 'my_profile':
            upsertProfile(payload);
            updateSelfIdentity();
            break;

        case 'user_profile':
            upsertProfile(payload);
            break;

        case 'profile_updated':
            upsertProfile(payload);
            if (payload.userId === state.selfId) updateSelfIdentity();
            break;

        case 'presence_updated': {
            upsertProfile({ userId: payload.userId, presenceStatus: payload.presenceStatus });
            if (payload.userId === state.selfId) {
                const selfDot = document.getElementById('selfPresenceDot');
                if (selfDot) applyPresenceDot(selfDot, payload.presenceStatus);
            } else {
                if (payload.presenceStatus === 'online') playUserOnlineSound();
                else if (payload.presenceStatus === 'offline') playUserOfflineSound();
            }
            break;
        }

        default: break;
    }
}
