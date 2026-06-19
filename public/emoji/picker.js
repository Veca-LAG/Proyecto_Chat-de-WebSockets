const EMOJIS = ['😀', '😁', '😂', '😊', '😍', '😎', '😢', '😡', '🤔', '😅', '👍', '👎', '👏', '🙏', '🤝', '🔥', '🎉', '💻', '📚', '✅', '❌', '🚀', '⭐', '❤️'];

/**
 * Selector de emojis optimizado:
 * - No se cierra al insertar un emoji.
 * - Permite insertar varios emojis seguidos.
 * - Solo se cierra al hacer clic fuera del selector y del botón.
 */
export function initEmojiPicker({ button, picker, input }) {
    if (!button || !picker || !input) return;
    picker.innerHTML = '';

    EMOJIS.forEach((emoji) => {
        const emojiButton = document.createElement('button');
        emojiButton.type = 'button';
        emojiButton.className = 'emoji-option';
        emojiButton.textContent = emoji;
        emojiButton.dataset.emoji = emoji;
        emojiButton.setAttribute('aria-label', `Insertar emoji ${emoji}`);
        emojiButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            insertAtCursor(input, emoji);
            input.focus();
        });
        picker.appendChild(emojiButton);
    });

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        picker.classList.toggle('hidden');
        input.focus();
    });

    picker.addEventListener('click', (event) => event.stopPropagation());

    document.addEventListener('click', (event) => {
        if (!picker.contains(event.target) && !button.contains(event.target)) {
            picker.classList.add('hidden');
        }
    });
}

function insertAtCursor(input, value) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${value}${input.value.slice(end)}`;
    const next = start + value.length;
    input.setSelectionRange(next, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
