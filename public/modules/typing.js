const TYPING_DEBOUNCE_MS = 1500;
let typingTimeout = null;
let currentlyTyping = false;

/**
 * Configura el evento de escritura para enviar estado escribiendo con debounce.
 * Usa input para funcionar también al pegar texto y en teclados móviles.
 * @param {object} options Opciones del indicador.
 * @param {HTMLInputElement} options.input Campo de texto.
 * @param {(isTyping:boolean) => void} options.sendTyping Función para avisar al servidor.
 * @param {() => boolean} [options.canSendTyping] Valida si el chat activo permite enviar typing.
 */
export function setupTypingEvents({ input, sendTyping, canSendTyping = () => true }) {
    const notifyStop = () => {
        window.clearTimeout(typingTimeout);
        if (currentlyTyping) {
            currentlyTyping = false;
            sendTyping(false);
        }
    };

    input.addEventListener('input', () => {
        const hasText = input.value.trim().length > 0;

        if (input.disabled || !canSendTyping() || !hasText) {
            notifyStop();
            return;
        }

        if (!currentlyTyping) {
            currentlyTyping = true;
            sendTyping(true);
        }

        window.clearTimeout(typingTimeout);
        typingTimeout = window.setTimeout(() => {
            currentlyTyping = false;
            sendTyping(false);
        }, TYPING_DEBOUNCE_MS);
    });

    input.addEventListener('blur', notifyStop);
}

/**
 * Muestra u oculta el indicador de usuarios escribiendo.
 * @param {HTMLElement} indicator Contenedor del indicador.
 * @param {{fromId?:string,nickname?:string,isTyping?:boolean,chatType?:string}} payload Datos recibidos.
 * @param {string|null} selfId ID del usuario actual.
 */
export function handleTypingStatus(indicator, payload, selfId) {
    if (!indicator || !payload) {
        return;
    }

    if (selfId && payload.fromId === selfId) {
        return;
    }

    if (payload.isTyping) {
        const name = payload.nickname || 'Alguien';
        indicator.textContent = `📝 ${name} está escribiendo...`;
        return;
    }

    clearTypingIndicator(indicator);
}

/**
 * Limpia el indicador visible de escritura.
 * @param {HTMLElement} indicator Contenedor del indicador.
 */
export function clearTypingIndicator(indicator) {
    if (indicator) {
        indicator.textContent = '';
    }
}

/**
 * Detiene el temporizador de escritura y notifica estado inactivo.
 * @param {(isTyping:boolean) => void} sendTyping Función para avisar al servidor.
 */
export function stopTyping(sendTyping) {
    window.clearTimeout(typingTimeout);
    if (currentlyTyping) {
        currentlyTyping = false;
        sendTyping(false);
    }
}
