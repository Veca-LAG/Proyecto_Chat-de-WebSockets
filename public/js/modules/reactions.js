// Fuente de verdad en memoria — se popula desde snapshots del servidor (PostgreSQL)
const reactionsMap = new Map(); // messageId → Record<emoji, {users: string[]}>

export function getMessageReactions(messageId) {
    return reactionsMap.get(messageId) || {};
}

function _set(messageId, data) {
    if (Object.keys(data).length === 0) {
        reactionsMap.delete(messageId);
    } else {
        reactionsMap.set(messageId, data);
    }
}

// Optimistic toggle local — devuelve 'add' o 'remove'
export function toggleReactionOptimistic(messageId, emoji, selfId) {
    const msg = { ...getMessageReactions(messageId) };
    const entry = msg[emoji] ? { ...msg[emoji], users: [...(msg[emoji].users || [])] } : { users: [] };
    const idx = entry.users.indexOf(selfId);
    const action = idx === -1 ? 'add' : 'remove';
    if (action === 'add') entry.users.push(selfId);
    else entry.users.splice(idx, 1);
    if (entry.users.length === 0) delete msg[emoji]; else msg[emoji] = entry;
    _set(messageId, msg);
    return action;
}

// Aplica una reacción individual recibida desde el servidor
export function applyIncomingReaction(messageId, emoji, userId, action, selfId) {
    if (!messageId || !emoji || !userId) return;
    const msg = { ...getMessageReactions(messageId) };
    const entry = msg[emoji] ? { ...msg[emoji], users: [...(msg[emoji].users || [])] } : { users: [] };
    const idx = entry.users.indexOf(userId);
    if (action === 'add' && idx === -1) entry.users.push(userId);
    if (action === 'remove' && idx !== -1) entry.users.splice(idx, 1);
    if (entry.users.length === 0) delete msg[emoji]; else msg[emoji] = entry;
    _set(messageId, msg);

    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) refreshReactionBar(messageId, el, selfId || userId);
}

// Aplica un snapshot completo de reacciones (viene del servidor al cargar historial)
export function applyReactionSnapshot(messageId, reactions, selfId) {
    if (!messageId || !Array.isArray(reactions)) return;
    const msg = {};
    for (const item of reactions) {
        const emoji = item.emoji;
        const users = Array.isArray(item.users) ? item.users : [];
        if (emoji && users.length) msg[emoji] = { users };
    }
    _set(messageId, msg);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) refreshReactionBar(messageId, el, selfId);
}

// Renderiza la barra de reacciones bajo el mensaje
export function refreshReactionBar(messageId, messageElement, selfId) {
    if (!messageId || !messageElement) return;
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
        pill.dataset.emoji = emoji;
        pill.innerHTML = `<span class="pill-emoji">${emoji}</span><span class="pill-count">${count}</span>`;
        bar.appendChild(pill);
    }
}


// Delegación global: permite tocar una reacción visible para agregarla o quitarla.
// La fuente de verdad sigue siendo el backend; esto solo envía la intención y espera snapshot.
let _reactionDelegationReady = false;

export function setupReactionPillClicks({ container, state, sendJson }) {
    if (_reactionDelegationReady || !container) return;
    _reactionDelegationReady = true;

    container.addEventListener('click', (event) => {
        const pill = event.target.closest('.msg-reaction-pill');
        if (!pill) return;

        const messageElement = pill.closest('[data-message-id]');
        const messageId = messageElement?.dataset.messageId;
        const emoji = pill.dataset.emoji || pill.querySelector('.pill-emoji')?.textContent;
        if (!messageId || !emoji) return;

        const messageKind = messageElement.dataset.kind || 'global';
        const groupId = messageElement.dataset.groupId || null;
        const fromId = messageElement.dataset.fromId || null;
        const toId = messageElement.dataset.toId || null;
        const isMine = pill.classList.contains('mine');
        const action = isMine ? 'remove' : 'add';

        let targetId = null;
        if (messageKind === 'private') {
            targetId = fromId === state.selfId ? toId : fromId;
        }

        // Pequeña actualización optimista; el servidor corregirá con el snapshot real.
        toggleReactionOptimistic(messageId, emoji, state.selfId);
        refreshReactionBar(messageId, messageElement, state.selfId);

        sendJson({
            type: 'react_message',
            payload: { messageId, emoji, action, kind: messageKind, groupId, targetId },
            timestamp: new Date().toISOString()
        });
    });
}
