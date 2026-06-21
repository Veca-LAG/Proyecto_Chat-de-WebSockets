export function setPrivateMode({ user, titleElement, subtitleElement, exitButton }) {
    titleElement.textContent = `Chat privado con ${user.nickname}`;
    subtitleElement.textContent = 'El mensaje será enviado únicamente a este usuario.';
    exitButton.classList.remove('hidden');
}

export function clearPrivateMode({ titleElement, subtitleElement, exitButton }) {
    titleElement.textContent = 'Foro global';
    subtitleElement.textContent = 'Mensajes públicos para todos los usuarios conectados.';
    exitButton.classList.add('hidden');
}

export function sendPrivate({ socketSender, targetUser, text, timestamp, replyTo = null, isForwarded = false, forwardedFromId = null }) {
    if (!targetUser || !targetUser.id) {
        return false;
    }

    return socketSender({
        type: 'private',
        payload: {
            targetId: targetUser.id,
            text,
            isForwarded,
            forwardedFromId,
            ...(replyTo ? { replyTo, replyToId: replyTo.id } : {})
        },
        timestamp
    });
}

export function receivePrivate(payload, timestamp, renderMessage, selfId) {
    renderMessage({
        from: payload.from,
        fromId: payload.fromId,
        text: payload.text,
        timestamp,
        kind: 'private',
        direction: payload.fromId === selfId ? 'out' : 'in'
    });
}
