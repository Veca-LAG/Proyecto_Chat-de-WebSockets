const DELETED_FOR_ME_KEY = 'ola_deleted_for_me';

let _state = null;
let _sendJson = null;
let _renderActiveChatMessages = null;
let _applyConversationSearch = null;
let _saveLocalState = null;

export function initMessageActions(config) {
    _state = config.state;
    _sendJson = config.sendJson;
    _renderActiveChatMessages = config.renderActiveChatMessages;
    _applyConversationSearch = config.applyConversationSearch;
    _saveLocalState = config.saveLocalState;
}

export function getDeletedForMe() {
    try { return new Set(JSON.parse(localStorage.getItem(DELETED_FOR_ME_KEY) || '[]')); }
    catch { return new Set(); }
}

export function saveDeletedForMe(ids) {
    localStorage.setItem(DELETED_FOR_ME_KEY, JSON.stringify([...ids]));
}

let _undoToastTimer = null;
let _currentUndoToast = null;

export function showUndoToast(onUndo) {
    if (_currentUndoToast) {
        clearTimeout(_undoToastTimer);
        _currentUndoToast.remove();
        _currentUndoToast = null;
    }

    const toast = document.createElement('div');
    toast.className = 'undo-toast';

    const textSpan = document.createElement('span');
    textSpan.className = 'undo-toast-text';
    textSpan.textContent = 'Mensaje eliminado';

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'undo-btn';
    undoBtn.textContent = 'Deshacer';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'undo-toast-close';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.textContent = '✕';

    const progress = document.createElement('span');
    progress.className = 'undo-toast-progress';

    toast.append(textSpan, undoBtn, closeBtn, progress);
    document.body.appendChild(toast);
    _currentUndoToast = toast;

    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

    function dismiss() {
        clearTimeout(_undoToastTimer);
        toast.classList.remove('show');
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 350);
        if (_currentUndoToast === toast) _currentUndoToast = null;
    }

    undoBtn.addEventListener('click', () => { dismiss(); onUndo(); });
    closeBtn.addEventListener('click', dismiss);
    _undoToastTimer = setTimeout(dismiss, 5000);
}

export function showDeleteDialog(message, messageElement, messageKind = 'private', groupId = null, isOwn = false) {
    const messageId   = message?.id;
    const messageText = message?.text || '';

    const overlay = document.createElement('div');
    overlay.className = 'msg-delete-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'msg-delete-sheet';

    const title = document.createElement('h2');
    title.className = 'msg-delete-title';
    title.textContent = '¿Deseas eliminar este mensaje?';
    sheet.appendChild(title);

    if (messageText && !message.deletedForAll) {
        const preview = document.createElement('div');
        preview.className = 'msg-delete-preview';

        const label = document.createElement('p');
        label.className = 'msg-delete-preview-label';
        label.textContent = message.from || message.nickname || 'Mensaje';

        const text = document.createElement('p');
        text.className = 'msg-delete-preview-text';
        text.textContent = messageText;

        preview.append(label, text);
        sheet.appendChild(preview);
    }

    function makeBtn(label, cls, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `msg-delete-btn ${cls}`;
        btn.textContent = label;
        btn.addEventListener('click', () => { overlay.remove(); onClick(); });
        return btn;
    }

    if (isOwn && !message.deletedForAll) {
        sheet.appendChild(makeBtn('Eliminar para todos', 'for-all', () => {
            _deleteForAll(messageId, messageKind, groupId);
        }));
    }

    sheet.appendChild(makeBtn('Eliminar para mí', 'for-me', () => {
        _deleteForMe(messageId, messageElement);
    }));
    sheet.appendChild(makeBtn('Cancelar', 'cancel', () => {}));

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function _deleteForAll(messageId, messageKind, groupId) {
    if (!messageId) return;
    if (messageKind === 'global') {
        _sendJson({ type: 'delete_global_message',  payload: { id: messageId }, timestamp: new Date().toISOString() });
    } else if (messageKind === 'group') {
        _sendJson({ type: 'delete_group_message',   payload: { id: messageId, groupId }, timestamp: new Date().toISOString() });
    } else {
        _sendJson({ type: 'delete_private_message', payload: { id: messageId }, timestamp: new Date().toISOString() });
    }
}

function _deleteForMe(messageId, messageElement) {
    if (messageElement) {
        messageElement.remove();
    } else if (messageId) {
        document.querySelector(`[data-message-id="${messageId}"]`)?.remove();
    }

    if (messageId) {
        const deleted = getDeletedForMe();
        deleted.add(messageId);
        saveDeletedForMe(deleted);
    }

    showUndoToast(() => {
        if (messageId) {
            const deleted = getDeletedForMe();
            deleted.delete(messageId);
            saveDeletedForMe(deleted);
        }
        _renderActiveChatMessages?.();
        _applyConversationSearch?.();
    });
}

export function markMessageDeletedEverywhere(id, deletedBy) {
    if (!id || !_state) return;

    const replacementText = deletedBy === _state.selfId
        ? 'Eliminaste este mensaje'
        : 'Se eliminó este mensaje';

    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (el) {
        el.classList.add('message-is-deleted');
        const contentEl = el.querySelector('.message-content');
        if (contentEl) {
            contentEl.textContent    = replacementText;
            contentEl.dataset.rawText = replacementText;
            contentEl.classList.add('message-deleted');
        }
    }

    const apply = (msg) => {
        if (!msg || msg.id !== id) return;
        msg.deletedForAll = true;
        msg.deletedBy     = deletedBy;
        msg.text          = replacementText;
    };

    _state.globalMessages.forEach(apply);
    Object.values(_state.privateConversations).forEach((conv) => (conv.messages || []).forEach(apply));
    _state.groups.forEach((group) => (group.history || []).forEach(apply));
    _saveLocalState?.();
}
