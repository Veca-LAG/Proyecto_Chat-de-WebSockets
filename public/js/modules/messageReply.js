export function setReplyingTo(message, state, elements) {
    state.replyingTo = {
        id: message.id || null,
        text: message.text || '',
        nickname: message.from || message.nickname || 'Usuario'
    };
    _renderReplyBar(state.replyingTo, state, elements);
    elements.messageInput?.focus();
}

export function clearReplyingTo(state, elements) {
    state.replyingTo = null;
    const slot = document.getElementById('replyComposerSlot') || elements.messageForm?.parentElement;
    slot?.querySelector('.reply-preview-bar')?.remove();
}

function _renderReplyBar(replyTo, state, elements) {
    const slot = document.getElementById('replyComposerSlot') || elements.messageForm?.parentElement;
    slot?.querySelector('.reply-preview-bar')?.remove();
    if (!slot) return;

    const bar = document.createElement('div');
    bar.className = 'reply-preview-bar';

    const line = document.createElement('div');
    line.className = 'reply-preview-line';

    const content = document.createElement('div');
    content.className = 'reply-preview-content';

    const name = document.createElement('span');
    name.className = 'reply-preview-name';
    name.textContent = replyTo.nickname || 'Usuario';

    const text = document.createElement('span');
    text.className = 'reply-preview-text';
    text.textContent = replyTo.text || '';

    content.append(name, text);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'reply-preview-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Cancelar respuesta');
    closeBtn.addEventListener('click', () => clearReplyingTo(state, elements));

    bar.append(line, content, closeBtn);
    slot.appendChild(bar);
}

export function renderReplyQuote(replyTo) {
    if (!replyTo?.text) return null;

    const quote = document.createElement('blockquote');
    quote.className = 'msg-reply-quote';

    if (replyTo.id) {
        quote.dataset.replyToId = replyTo.id;
        quote.addEventListener('click', () => scrollToMessage(replyTo.id));
    }

    const name = document.createElement('span');
    name.className = 'msg-reply-quote-name';
    name.textContent = replyTo.nickname || replyTo.author || 'Usuario';

    const text = document.createElement('p');
    text.className = 'msg-reply-quote-text';
    const MAX = 120;
    const value = String(replyTo.text || '');
    text.textContent = value.length > MAX ? value.slice(0, MAX) + '…' : value;

    quote.append(name, text);
    return quote;
}

function scrollToMessage(id) {
    const target = document.querySelector(`[data-message-id="${id}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('msg-highlight');
    target.addEventListener('animationend', () => target.classList.remove('msg-highlight'), { once: true });
}
