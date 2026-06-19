/**
 * Activa visualmente el modo de mensaje privado.
 * @param {object} options Opciones de UI.
 * @param {{id:string,nickname:string}} options.user Usuario destino.
 * @param {HTMLElement} options.titleElement Título del chat.
 * @param {HTMLElement} options.subtitleElement Subtítulo del chat.
 * @param {HTMLElement} options.exitButton Botón para volver al chat global.
 */
export function setPrivateMode({ user, titleElement, subtitleElement, exitButton }) {
    titleElement.textContent = `Chat privado con ${user.nickname}`;
    subtitleElement.textContent = 'El mensaje será enviado únicamente a este usuario.';
    exitButton.classList.remove('hidden');
}

/**
 * Restaura visualmente el modo global.
 * @param {object} options Opciones de UI.
 * @param {HTMLElement} options.titleElement Título del chat.
 * @param {HTMLElement} options.subtitleElement Subtítulo del chat.
 * @param {HTMLElement} options.exitButton Botón para volver al chat global.
 */
export function clearPrivateMode({ titleElement, subtitleElement, exitButton }) {
    titleElement.textContent = 'Foro global';
    subtitleElement.textContent = 'Mensajes públicos para todos los usuarios conectados.';
    exitButton.classList.add('hidden');
}

/**
 * Envía un mensaje privado usando el protocolo JSON definido para WebSocket.
 * @param {object} options Configuración del envío privado.
 * @param {(data:object) => boolean} options.socketSender Función que envía JSON al servidor.
 * @param {{id:string,nickname:string}} options.targetUser Usuario destinatario.
 * @param {string} options.text Texto a enviar.
 * @param {string} options.timestamp Fecha ISO del mensaje.
 * @returns {boolean} True si el envío se solicitó correctamente.
 */
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

/**
 * Renderiza un mensaje privado recibido desde el servidor.
 * @param {object} payload Información del mensaje privado.
 * @param {string} timestamp Fecha ISO del servidor.
 * @param {(message:object) => void} renderMessage Función de renderizado del app principal.
 * @param {string|null} selfId ID del usuario actual.
 */
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
