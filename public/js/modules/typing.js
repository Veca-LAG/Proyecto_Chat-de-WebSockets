const TYPING_DEBOUNCE_MS = 1500;
let typingTimeout = null;
let currentlyTyping = false;

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

export function handleTypingStatus(indicator, payload, selfId) {
    if (!indicator || !payload) return;
    if (selfId && payload.fromId === selfId) return;

    if (payload.isTyping) {
        const name = payload.nickname || 'Alguien';
        indicator.innerHTML = '';

        const textSpan = document.createElement('span');
        textSpan.textContent = `📝 ${name} está escribiendo `;
        textSpan.style.marginRight = '4px';

        const bounceContainer = document.createElement('div');
        bounceContainer.className = 'typing-indicator-bounce';

        for (let i = 0; i < 3; i++) {
            bounceContainer.appendChild(document.createElement('span'));
        }

        indicator.appendChild(textSpan);
        indicator.appendChild(bounceContainer);
        return;
    }

    clearTypingIndicator(indicator);
}

export function clearTypingIndicator(indicator) {
    if (indicator) indicator.innerHTML = '';
}

export function stopTyping(sendTyping) {
    window.clearTimeout(typingTimeout);
    if (currentlyTyping) {
        currentlyTyping = false;
        sendTyping(false);
    }
}
