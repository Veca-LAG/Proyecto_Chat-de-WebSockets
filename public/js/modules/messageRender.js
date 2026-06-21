import { state, elements } from '../state.js';
import { formatTime } from '../shared/utils.js';
import { getDeletedForMe } from './messageActions.js';
import { buildMessageMenu, startInlineEdit } from './messageMenu.js';
import { refreshReactionBar, applyReactionSnapshot } from './reactions.js';
import { setReplyingTo, renderReplyQuote } from './messageReply.js';
import { ensurePrivateConversation } from './chatSelect.js';
import { sendJson } from '../socket.js';
import { applyConversationSearch } from './search.js';

export function scrollToLastMessage() {
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

export function renderActiveChatMessages() {
    elements.messages.innerHTML = '';
    if (!state.activeChat) return;

    if (state.activeChat.type === 'global') {
        state.globalMessages.forEach((m) => renderMessage({ ...m, kind: 'global' }));
        return;
    }

    if (state.activeChat.type === 'private') {
        const conv = ensurePrivateConversation(state.activeChat.name);
        conv.messages.forEach((m) => renderMessage(m));
        return;
    }

    const group = state.groups.find((g) => g.id === state.activeChat.id);
    (group?.history || []).forEach((m) => renderMessage({ ...m, kind: 'group' }));
}

export function renderMessage(message) {
    if (message.id && getDeletedForMe().has(message.id)) return;

    const el = document.createElement('article');
    const isOwn = message.fromId && message.fromId === state.selfId;
    const messageKind = message.kind || 'global';

    if (message.id) el.dataset.messageId = message.id;
    el.dataset.kind = messageKind;
    if (message.groupId) el.dataset.groupId = message.groupId;
    if (message.fromId) el.dataset.fromId = message.fromId;
    if (message.toId) el.dataset.toId = message.toId;

    const deletedForAll = Boolean(message.deletedForAll || message.deleted_for_all);
    const deletedBy = message.deletedBy || message.deleted_by || null;

    el.className = [
        'message',
        isOwn ? 'message-own' : 'message-other',
        messageKind === 'private' ? 'message-private' : '',
        messageKind === 'group' ? 'message-group' : '',
        message.historical ? 'message-historical' : '',
        deletedForAll ? 'message-is-deleted' : ''
    ].filter(Boolean).join(' ');

    const metaEl = document.createElement('div');
    metaEl.className = 'message-meta';

    const authorEl = document.createElement('strong');
    authorEl.textContent = isOwn ? 'Tú' : (message.nickname || message.from || 'Usuario');

    const timeEl = document.createElement('time');
    timeEl.dateTime = message.timestamp || new Date().toISOString();
    timeEl.textContent = formatTime(message.timestamp);
    metaEl.append(authorEl, timeEl);

    if (message.isForwarded || message.is_forwarded) {
        const fwd = document.createElement('div');
        fwd.className = 'forwarded-label';
        fwd.textContent = '↪ Mensaje reenviado';
        el.appendChild(fwd);
    }

    if (message.replyTo) {
        const quote = renderReplyQuote(message.replyTo);
        if (quote) el.append(quote);
    }

    const textEl = document.createElement('p');
    textEl.className = 'message-content';
    const visibleText = deletedForAll
        ? (deletedBy === state.selfId ? 'Eliminaste este mensaje' : 'Se eliminó este mensaje')
        : (message.text || '');
    textEl.dataset.rawText = visibleText;
    textEl.textContent = visibleText;
    if (deletedForAll) textEl.classList.add('message-deleted');

    el.append(metaEl, textEl);

    if (Array.isArray(message.reactions)) {
        applyReactionSnapshot(message.id, message.reactions, state.selfId);
    }

    const menu = buildMessageMenu({
        message: { ...message, deletedForAll },
        messageElement: el,
        messageKind,
        isOwn,
        state,
        sendJsonFn: sendJson,
        onReply: (msg) => {
            if (deletedForAll) return;
            setReplyingTo(msg, state, elements);
        },
        onStartEdit: (msg, msgEl) => startInlineEdit(msg, msgEl, sendJson, messageKind),
        onDeleteClick: () => {
            import('./messageActions.js').then(({ showDeleteDialog }) => {
                showDeleteDialog(
                    { ...message, deletedForAll },
                    el,
                    messageKind,
                    message.groupId || null,
                    isOwn
                );
            });
        }
    });
    el.appendChild(menu);

    elements.messages.appendChild(el);
    if (message.id) refreshReactionBar(message.id, el, state.selfId);
    applyConversationSearch();
    scrollToLastMessage();
}

export function renderSystemMessage(text, timestamp = new Date().toISOString()) {
    if (!state.activeChat) return;
    const sysEl = document.createElement('p');
    sysEl.className = 'system-message';
    const sysText = `${formatTime(timestamp)} · ${text}`;
    sysEl.dataset.rawText = sysText;
    sysEl.textContent = sysText;
    elements.messages.appendChild(sysEl);
    applyConversationSearch();
    scrollToLastMessage();
}
