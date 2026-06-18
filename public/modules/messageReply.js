/**
 * Sistema de respuesta/cita de mensajes.
 * Gestiona la barra de preview en el compositor y el bloque de cita dentro del mensaje.
 */

export function setReplyingTo(message, state, elements) {
    state.replyingTo = {
        id:       message.id       || null,
        text:     message.text     || '',
        nickname: message.from     || message.nickname || 'Usuario'
    };
    _renderReplyBar(state.replyingTo, state, elements);
    elements.messageInput?.focus();
}

export function clearReplyingTo(state, elements) {
    state.replyingTo = null;
    elements.messageForm?.querySelector('.reply-preview-bar')?.remove();
}

function _renderReplyBar(replyTo, state, elements) {
    elements.messageForm?.querySelector('.reply-preview-bar')?.remove();
    if (!elements.messageForm) return;

    const bar = document.createElement('div');
    bar.className = 'reply-preview-bar';

    const line = document.createElement('div');
    line.className = 'reply-preview-line';

    const content = document.createElement('div');
    content.className = 'reply-preview-content';

    const name = document.createElement('span');
    name.className = 'reply-preview-name';
    name.textContent = replyTo.nickname;

    const text = document.createElement('span');
    text.className = 'reply-preview-text';
    text.textContent = replyTo.text;

    content.append(name, text);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'reply-preview-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Cancelar respuesta');
    closeBtn.addEventListener('click', () => clearReplyingTo(state, elements));

    bar.append(line, content, closeBtn);
    elements.messageForm.prepend(bar);
}

/**
 * Crea el bloque de cita que se muestra dentro del mensaje que contiene una respuesta.
 * @param {{nickname:string, text:string}} replyTo
 * @returns {HTMLElement|null}
 */
export function renderReplyQuote(replyTo) {
    if (!replyTo?.text) return null;

    const quote = document.createElement('blockquote');
    quote.className = 'msg-reply-quote';

    const name = document.createElement('span');
    name.className = 'msg-reply-quote-name';
    name.textContent = replyTo.nickname || 'Usuario';

    const text = document.createElement('p');
    text.className = 'msg-reply-quote-text';
    const MAX = 120;
    text.textContent = replyTo.text.length > MAX
        ? replyTo.text.slice(0, MAX) + '…'
        : replyTo.text;

    quote.append(name, text);
    return quote;
}
