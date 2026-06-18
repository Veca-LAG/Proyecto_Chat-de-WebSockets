// ── REACCIONES (localStorage + sync en tiempo real) ──────────────────────
const REACTIONS_KEY   = 'ola_reactions';
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const reactionHandlers = new Map();

function getStoredReactions() {
    try { return JSON.parse(localStorage.getItem(REACTIONS_KEY) || '{}'); }
    catch { return {}; }
}
function saveStoredReactions(data) {
    localStorage.setItem(REACTIONS_KEY, JSON.stringify(data));
}

export function getMessageReactions(messageId) {
    return getStoredReactions()[messageId] || {};
}

// emoji → { users: [userId, ...] }
function toggleReactionLocal(messageId, emoji, selfId) {
    const all = getStoredReactions();
    const msg = { ...(all[messageId] || {}) };
    const entry = msg[emoji] ? { ...msg[emoji] } : { users: [] };
    const idx   = entry.users.indexOf(selfId);
    const action = idx === -1 ? 'add' : 'remove';
    if (action === 'add') entry.users.push(selfId);
    else entry.users.splice(idx, 1);
    if (entry.users.length === 0) delete msg[emoji]; else msg[emoji] = entry;
    if (Object.keys(msg).length === 0) delete all[messageId]; else all[messageId] = msg;
    saveStoredReactions(all);
    return action;
}

/**
 * Aplica una reacción entrante desde el servidor (otro usuario reaccionó).
 * Actualiza localStorage y refresca la barra en el DOM.
 */
export function applyIncomingReaction(messageId, emoji, userId, action, selfId) {
    const all = getStoredReactions();
    const msg = { ...(all[messageId] || {}) };
    const entry = msg[emoji] ? { ...msg[emoji] } : { users: [] };
    const idx = entry.users.indexOf(userId);
    if (action === 'add' && idx === -1) entry.users.push(userId);
    if (action === 'remove' && idx !== -1) entry.users.splice(idx, 1);
    if (entry.users.length === 0) delete msg[emoji]; else msg[emoji] = entry;
    if (Object.keys(msg).length === 0) delete all[messageId]; else all[messageId] = msg;
    saveStoredReactions(all);

    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) refreshReactionBar(messageId, el, selfId || userId);
}

export function refreshReactionBar(messageId, messageElement, selfId) {
    let bar = messageElement.querySelector('.msg-reactions');
    const reactions = getMessageReactions(messageId);
    if (Object.keys(reactions).length === 0) { bar?.remove(); return; }
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'msg-reactions';
        messageElement.appendChild(bar);
    }
    bar.innerHTML = '';
    for (const [emoji, entry] of Object.entries(reactions)) {
        const count = entry.users?.length ?? 1;
        if (count === 0) continue;
        const isMine = selfId ? entry.users?.includes(selfId) : false;
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `msg-reaction-pill${isMine ? ' mine' : ''}`;
        pill.title = isMine ? 'Quitar reacción' : `${count} reacción${count !== 1 ? 'es' : ''}`;

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'pill-emoji';
        emojiSpan.textContent = emoji;

        const countSpan = document.createElement('span');
        countSpan.className = 'pill-count';
        countSpan.textContent = count;

        pill.append(emojiSpan, countSpan);
        pill.dataset.emoji = emoji;
        pill.addEventListener('click', (event) => {
            event.stopPropagation();
            reactionHandlers.get(messageId)?.(emoji);
        });
        bar.appendChild(pill);
    }
}

// ── INFO DEL MENSAJE ──────────────────────────────────────────────────────
function showMessageInfo(message) {
    const overlay = document.createElement('div');
    overlay.className = 'msg-overlay';

    const card = document.createElement('div');
    card.className = 'msg-info-card';

    const kindMap = { global: 'Foro Global', private: 'Privado', group: 'Grupo' };
    const time = message.timestamp
        ? new Date(message.timestamp).toLocaleString('es', {
            weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
          })
        : 'Hora desconocida';

    const header = document.createElement('header');
    header.className = 'msg-info-header';
    const title = document.createElement('h3');
    title.textContent = 'Info. del mensaje';
    header.append(title, _closeBtn(() => overlay.remove()));

    const body = document.createElement('div');
    body.className = 'msg-info-body';

    const bubble = document.createElement('div');
    bubble.className = 'msg-info-bubble';
    bubble.textContent = message.text || '';
    body.appendChild(bubble);

    for (const [label, value] of [
        ['Enviado', time],
        ['De', message.from || message.nickname || 'Tú'],
        ['Canal', kindMap[message.kind || 'global'] || 'Global'],
    ]) {
        const row = document.createElement('div');
        row.className = 'msg-info-row';
        const l = document.createElement('span'); l.className = 'msg-info-label'; l.textContent = label;
        const v = document.createElement('span'); v.className = 'msg-info-value'; v.textContent = value;
        row.append(l, v);
        body.appendChild(row);
    }

    card.append(header, body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── COPIAR ────────────────────────────────────────────────────────────────
async function copyMessage(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
        const ta = Object.assign(document.createElement('textarea'), { value: text });
        Object.assign(ta.style, { position: 'fixed', opacity: '0' });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
    showMiniToast('Mensaje copiado');
}

export function showMiniToast(text) {
    const toast = document.createElement('div');
    toast.className = 'msg-mini-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2200);
}

// ── REENVIAR ──────────────────────────────────────────────────────────────
export function showForwardPicker(message, state, sendJsonFn) {
    const overlay = document.createElement('div');
    overlay.className = 'msg-overlay';

    const card = document.createElement('div');
    card.className = 'msg-forward-card';

    const header = document.createElement('header');
    header.className = 'msg-forward-header';
    const title = document.createElement('h3');
    title.textContent = 'Reenviar mensaje';
    header.append(title, _closeBtn(() => overlay.remove()));

    const list = document.createElement('ul');
    list.className = 'msg-forward-list';

    const users  = (state.users  || []).filter(u => u.id !== state.selfId);
    const groups = state.groups  || [];

    if (users.length === 0 && groups.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'msg-forward-empty';
        empty.textContent = 'No hay contactos disponibles';
        list.appendChild(empty);
    }

    for (const user of users) {
        list.appendChild(_forwardItem(
            (user.nickname || '?')[0].toUpperCase(), user.nickname, false,
            () => { sendJsonFn({ type: 'private', payload: { targetId: user.id, text: message.text }, timestamp: new Date().toISOString() }); overlay.remove(); showMiniToast('Mensaje reenviado'); }
        ));
    }
    for (const group of groups) {
        list.appendChild(_forwardItem(
            '#', group.name, true,
            () => { sendJsonFn({ type: 'group_message', payload: { groupId: group.id, text: message.text }, timestamp: new Date().toISOString() }); overlay.remove(); showMiniToast('Mensaje reenviado'); }
        ));
    }

    card.append(header, list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function _forwardItem(avatarText, name, isGroup, onClick) {
    const li = document.createElement('li');
    li.className = 'msg-forward-item';
    const av = document.createElement('span');
    av.className = `msg-fwd-avatar${isGroup ? ' msg-fwd-group' : ''}`;
    av.textContent = avatarText;
    const nm = document.createElement('span');
    nm.className = 'msg-fwd-name';
    nm.textContent = name;
    li.append(av, nm);
    li.addEventListener('click', onClick);
    return li;
}

// ── EDITAR (inline) ───────────────────────────────────────────────────────
export function startInlineEdit(message, messageElement, sendJsonFn, messageKind) {
    const contentEl = messageElement.querySelector('.message-content');
    if (!contentEl || messageElement.querySelector('.msg-edit-form')) return;

    const originalText = message.text || '';

    const form = document.createElement('form');
    form.className = 'msg-edit-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'msg-edit-input';
    textarea.value = originalText;
    textarea.maxLength = 300;
    textarea.rows = Math.min(4, Math.ceil(originalText.length / 48) + 1);

    const hint = document.createElement('p');
    hint.className = 'msg-edit-hint';
    hint.textContent = 'Enter para guardar · Esc para cancelar';

    const actions = document.createElement('div');
    actions.className = 'msg-edit-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'msg-edit-cancel';
    cancelBtn.textContent = 'Cancelar';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'msg-edit-save';
    saveBtn.textContent = 'Guardar';

    actions.append(cancelBtn, saveBtn);
    form.append(textarea, hint, actions);
    contentEl.replaceWith(form);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const cancel = () => form.replaceWith(contentEl);

    const save = () => {
        const newText = textarea.value.trim();
        if (!newText) return;
        if (newText !== originalText) {
            sendJsonFn({ type: 'edit_message', payload: { id: message.id, text: newText, kind: messageKind, groupId: message.groupId || null }, timestamp: new Date().toISOString() });
            contentEl.textContent = newText;
            contentEl.dataset.rawText = newText;
            message.text = newText;
            addEditedTag(messageElement);
        }
        form.replaceWith(contentEl);
    };

    cancelBtn.addEventListener('click', cancel);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
        if (e.key === 'Escape') cancel();
    });
}

export function addEditedTag(messageElement) {
    if (!messageElement.querySelector('.msg-edited-tag')) {
        const tag = document.createElement('span');
        tag.className = 'msg-edited-tag';
        tag.textContent = ' · editado';
        messageElement.querySelector('.message-meta')?.appendChild(tag);
    }
}

// ── CONSTRUCTOR DEL MENÚ ──────────────────────────────────────────────────
function getPrivateTargetId(message, state) {
    if (!message || !state) return null;
    if (message.fromId && message.fromId !== state.selfId) return message.fromId;
    if (message.toId && message.toId !== state.selfId) return message.toId;

    const activeName = state.activeChat?.type === 'private' ? state.activeChat.name : null;
    const activeUser = activeName ? (state.users || []).find((u) => u.nickname === activeName) : null;
    return activeUser?.id || null;
}

function syncReaction({ message, messageElement, messageKind, state, sendJsonFn, emoji }) {
    if (!message?.id || !state?.selfId) return;

    const action = toggleReactionLocal(message.id, emoji, state.selfId);
    refreshReactionBar(message.id, messageElement, state.selfId);

    if (!sendJsonFn) return;

    sendJsonFn({
        type: 'react_message',
        payload: {
            messageId: message.id,
            emoji,
            action,
            kind: messageKind,
            groupId: message.groupId || null,
            targetId: messageKind === 'private' ? getPrivateTargetId(message, state) : null
        },
        timestamp: new Date().toISOString()
    });
}

function closeOpenMessageMenus() {
    document.querySelectorAll('.msg-actions-layer').forEach((layer) => layer.remove());
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function positionActionsLayer({ messageElement, layer, reactionBar, popover, isOwn }) {
    const rect = messageElement.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;

    const popoverRect = popover.getBoundingClientRect();
    const reactionRect = reactionBar.getBoundingClientRect();

    let popoverLeft = isOwn ? rect.right - popoverRect.width : rect.left;
    popoverLeft = clamp(popoverLeft, viewportPadding, window.innerWidth - popoverRect.width - viewportPadding);

    let popoverTop = rect.top + 30;
    if (popoverTop + popoverRect.height > window.innerHeight - viewportPadding) {
        popoverTop = rect.bottom - popoverRect.height;
    }
    popoverTop = clamp(popoverTop, viewportPadding, window.innerHeight - popoverRect.height - viewportPadding);

    let reactionLeft = isOwn ? rect.right - reactionRect.width : rect.left;
    reactionLeft = clamp(reactionLeft, viewportPadding, window.innerWidth - reactionRect.width - viewportPadding);

    let reactionTop = popoverTop - reactionRect.height - gap;
    if (reactionTop < viewportPadding) {
        reactionTop = popoverTop + popoverRect.height + gap;
    }
    reactionTop = clamp(reactionTop, viewportPadding, window.innerHeight - reactionRect.height - viewportPadding);

    popover.style.left = `${popoverLeft}px`;
    popover.style.top = `${popoverTop}px`;
    reactionBar.style.left = `${reactionLeft}px`;
    reactionBar.style.top = `${reactionTop}px`;
    layer.classList.add('is-positioned');
}

function openMessageActions({ message, messageElement, messageKind, isOwn, state, sendJsonFn, onReply, onStartEdit, onDeleteClick }) {
    closeOpenMessageMenus();

    const layer = document.createElement('div');
    layer.className = 'msg-actions-layer';

    const reactionBar = document.createElement('div');
    reactionBar.className = 'msg-floating-reactions';

    const react = (emoji) => {
        syncReaction({ message, messageElement, messageKind, state, sendJsonFn, emoji });
        closeOpenMessageMenus();
    };

    if (message.id) {
        reactionHandlers.set(message.id, react);
    }

    const stored = message.id ? getMessageReactions(message.id) : {};
    for (const emoji of QUICK_REACTIONS) {
        const entry = stored[emoji] || { users: [] };
        const isMine = state.selfId && entry.users?.includes(state.selfId);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `msg-floating-reaction${isMine ? ' active' : ''}`;
        btn.textContent = emoji;
        btn.title = emoji;
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            react(emoji);
        });
        reactionBar.appendChild(btn);
    }

    const popover = document.createElement('div');
    popover.className = `msg-actions-popover${isOwn ? ' is-own' : ''}`;

    const addItem = (icon, label, cls, onClick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `msg-action-item${cls ? ' ' + cls : ''}`;
        const iconEl  = document.createElement('span'); iconEl.className  = 'msg-action-icon';  iconEl.textContent  = icon;
        const labelEl = document.createElement('span'); labelEl.className = 'msg-action-label'; labelEl.textContent = label;
        btn.append(iconEl, labelEl);
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            closeOpenMessageMenus();
            onClick?.();
        });
        popover.appendChild(btn);
    };

    addItem('↩',  'Responder', '', () => onReply(message));
    addItem('⧉',  'Copiar', '', () => copyMessage(message.text || ''));
    addItem('↗',  'Reenviar', '', () => showForwardPicker(message, state, sendJsonFn));
    if (isOwn) addItem('✎', 'Editar', '', () => onStartEdit(message, messageElement));
    addItem('🗑',  'Eliminar', 'delete-action', () => onDeleteClick());

    layer.append(reactionBar, popover);
    document.body.appendChild(layer);

    layer.addEventListener('click', (event) => {
        if (event.target === layer) closeOpenMessageMenus();
    });

    const onKeydown = (event) => {
        if (event.key === 'Escape') {
            closeOpenMessageMenus();
            document.removeEventListener('keydown', onKeydown);
        }
    };
    document.addEventListener('keydown', onKeydown);

    requestAnimationFrame(() => positionActionsLayer({ messageElement, layer, reactionBar, popover, isOwn }));
}

export function buildMessageMenu({ message, messageElement, messageKind, isOwn, state, sendJsonFn, onReply, onStartEdit, onDeleteClick }) {
    const container = document.createElement('div');
    container.className = `message-menu-container${isOwn ? ' menu-own' : ''}`;

    const triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.className = 'message-menu-trigger';
    triggerBtn.innerHTML = '&#709;';
    triggerBtn.title = 'Opciones';
    triggerBtn.setAttribute('aria-label', 'Opciones del mensaje');

    if (message.id) {
        reactionHandlers.set(message.id, (emoji) => {
            syncReaction({ message, messageElement, messageKind, state, sendJsonFn, emoji });
        });
        refreshReactionBar(message.id, messageElement, state.selfId);
    }

    triggerBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openMessageActions({ message, messageElement, messageKind, isOwn, state, sendJsonFn, onReply, onStartEdit, onDeleteClick });
    });

    container.appendChild(triggerBtn);
    return container;
}

// ── UTILIDADES PRIVADAS ───────────────────────────────────────────────────
function _closeBtn(onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-modal-close';
    btn.textContent = '✕';
    btn.setAttribute('aria-label', 'Cerrar');
    btn.addEventListener('click', onClick);
    return btn;
}
