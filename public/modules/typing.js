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
 * Muestra u oculta el indicador de usuarios escribiendo con soporte para animación CSS.
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
        
        // 🌟 Limpiamos el contenedor para armar la estructura dinámica
        indicator.innerHTML = '';

        // Creamos un contenedor de texto para el nombre
        const textSpan = document.createElement('span');
        textSpan.textContent = `📝 ${name} está escribiendo `;
        textSpan.style.marginRight = '4px';

        // Creamos la envoltura con la clase que configuramos en el CSS (.typing-indicator-bounce)
        const bounceContainer = document.createElement('div');
        bounceContainer.className = 'typing-indicator-bounce';

        // Insertamos los 3 puntitos que saltarán con la animación CSS
        for (let i = 0; i < 3; i++) {
            bounceContainer.appendChild(document.createElement('span'));
        }

        // Metemos todo dentro de tu elemento indicador
        indicator.appendChild(textSpan);
        indicator.appendChild(bounceContainer);
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
        indicator.innerHTML = '';
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