import { isMobile, attachLongPress } from './mobileActions.js';
import { toggleReactionOptimistic, refreshReactionBar } from './reactions.js';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
let currentOverlay = null;

export function showMiniToast(text) {
    const toast = document.createElement('div');
    toast.className = 'msg-mini-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2200);
}

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

function closeFloatingMessageMenu() {
    if (currentOverlay) {
        currentOverlay.remove();
        currentOverlay = null;
    }
}

function getEventPoint(event, fallbackElement) {
    const rect = fallbackElement.getBoundingClientRect();
    return {
        x: event?.clientX || rect.right,
        y: event?.clientY || rect.top
    };
}

function openFloatingMessageMenu(config, point) {
    closeFloatingMessageMenu();

    const { message, messageElement, messageKind, isOwn, state, sendJsonFn, onReply, onStartEdit, onDeleteClick } = config;

    const overlay = document.createElement('div');
    overlay.className = 'wa-menu-overlay';

    const reactionBar = document.createElement('div');
    reactionBar.className = 'wa-reaction-bar';

    for (const emoji of QUICK_REACTIONS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = emoji;
        btn.setAttribute('aria-label', `Reaccionar con ${emoji}`);
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const action = toggleReactionOptimistic(message.id, emoji, state.selfId);
            refreshReactionBar(message.id, messageElement, state.selfId);
            if (message.id && sendJsonFn) {
                const targetId = messageKind === 'private'
                    ? (isOwn ? message.toId : message.fromId)
                    : null;
                sendJsonFn({
                    type: 'react_message',
                    payload: {
                        messageId: message.id,
                        emoji,
                        action,
                        kind: messageKind,
                        groupId: message.groupId || null,
                        targetId
                    },
                    timestamp: new Date().toISOString()
                });
            }
            closeFloatingMessageMenu();
        });
        reactionBar.appendChild(btn);
    }

    const menu = document.createElement('div');
    menu.className = 'wa-message-menu';

    const addItem = (icon, label, className, onClick, disabled = false) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `wa-menu-item${className ? ' ' + className : ''}`;
        btn.disabled = disabled;
        btn.innerHTML = `<span class="wa-menu-icon">${icon}</span><span>${label}</span>`;
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            closeFloatingMessageMenu();
            onClick();
        });
        menu.appendChild(btn);
    };

    addItem('↩', 'Responder', '', () => onReply(message));
    addItem('⧉', 'Copiar', '', () => copyMessage(message.text || ''));
    addItem('☺', 'Reaccionar', '', () => {}, true);
    addItem('↪', 'Reenviar', '', () => showForwardPicker(message, state, sendJsonFn));
    if (isOwn && !message.deletedForAll) addItem('✎', 'Editar', '', () => onStartEdit(message, messageElement));
    addItem('🗑', 'Eliminar', 'danger', () => onDeleteClick());

    overlay.append(reactionBar, menu);
    document.body.appendChild(overlay);
    currentOverlay = overlay;

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeFloatingMessageMenu();
    });

    requestAnimationFrame(() => {
        if (isMobile()) {
            menu.classList.add('is-bottom-sheet');
            reactionBar.classList.add('is-mobile');
            return;
        }
        const x = Math.min(point.x, window.innerWidth - 230);
        const y = Math.min(point.y + 8, window.innerHeight - 360);
        menu.style.left = `${Math.max(8, x)}px`;
        menu.style.top = `${Math.max(8, y)}px`;
        reactionBar.style.left = `${Math.max(8, x - 32)}px`;
        reactionBar.style.top = `${Math.max(8, y - 58)}px`;
    });
}

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

    const users = (state.users || []).filter(u => u.id !== state.selfId);
    const groups = state.groups || [];

    if (users.length === 0 && groups.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'msg-forward-empty';
        empty.textContent = 'No hay contactos disponibles';
        list.appendChild(empty);
    }

    for (const user of users) {
        list.appendChild(_forwardItem((user.nickname || '?')[0].toUpperCase(), user.nickname, false, () => {
            sendJsonFn({
                type: 'private',
                payload: { targetId: user.id, text: message.text, isForwarded: true, forwardedFromId: message.id || null },
                timestamp: new Date().toISOString()
            });
            overlay.remove();
            showMiniToast('Mensaje reenviado');
        }));
    }
    for (const group of groups) {
        list.appendChild(_forwardItem('#', group.name, true, () => {
            sendJsonFn({
                type: 'group_message',
                payload: { groupId: group.id, text: message.text, isForwarded: true, forwardedFromId: message.id || null },
                timestamp: new Date().toISOString()
            });
            overlay.remove();
            showMiniToast('Mensaje reenviado');
        }));
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

export function startInlineEdit(message, messageElement, sendJsonFn, messageKind) {
    if (message.deletedForAll) return;
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

export function buildMessageMenu(config) {
    const { message, messageElement, isOwn } = config;
    const container = document.createElement('div');
    container.className = `message-menu-container${isOwn ? ' menu-own' : ''}`;

    const triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.className = 'message-menu-trigger';
    triggerBtn.innerHTML = '&#9660;';
    triggerBtn.title = 'Opciones';
    triggerBtn.setAttribute('aria-label', 'Opciones del mensaje');

    triggerBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFloatingMessageMenu(config, getEventPoint(event, messageElement));
    });

    messageElement.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openFloatingMessageMenu(config, getEventPoint(event, messageElement));
    });

    attachLongPress(messageElement, (event) => {
        openFloatingMessageMenu(config, getEventPoint(event, messageElement));
    }, 560);

    container.append(triggerBtn);
    refreshReactionBar(message.id, messageElement, config.state.selfId);
    return container;
}

function _closeBtn(onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-modal-close';
    btn.textContent = '✕';
    btn.setAttribute('aria-label', 'Cerrar');
    btn.addEventListener('click', onClick);
    return btn;
}
