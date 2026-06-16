const EMOJIS = ['😀', '😁', '😂', '😊', '😍', '😎', '😢', '😡', '🤔', '😅', '👍', '👎', '👏', '🙏', '🤝', '🔥', '🎉', '💻', '📚', '✅', '❌', '🚀', '⭐', '❤️'];

/**
 * Inicializa un selector básico de emojis sin librerías externas.
 * @param {object} options Opciones del selector.
 * @param {HTMLButtonElement} options.button Botón que abre/cierra el selector.
 * @param {HTMLElement} options.picker Panel flotante.
 * @param {HTMLInputElement} options.input Campo donde se inserta el emoji.
 */
export function initEmojiPicker({ button, picker, input }) {
    picker.innerHTML = '';

    EMOJIS.forEach((emoji) => {
        const emojiButton = document.createElement('button');
        emojiButton.type = 'button';
        emojiButton.className = 'emoji-option';
        emojiButton.textContent = emoji;
        emojiButton.setAttribute('aria-label', `Insertar emoji ${emoji}`);
        emojiButton.addEventListener('click', () => {
            insertAtCursor(input, emoji);
            picker.classList.add('hidden');
            input.focus();
        });
        picker.appendChild(emojiButton);
    });

    button.addEventListener('click', (event) => {
        event.stopPropagation();
        picker.classList.toggle('hidden');
    });

    document.addEventListener('click', (event) => {
        if (!picker.contains(event.target) && event.target !== button) {
            picker.classList.add('hidden');
        }
    });
}

/**
 * Inserta texto en la posición actual del cursor.
 * @param {HTMLInputElement} input Campo destino.
 * @param {string} value Texto a insertar.
 */
function insertAtCursor(input, value) {
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    input.value = `${input.value.slice(0, start)}${value}${input.value.slice(end)}`;
    input.selectionStart = start + value.length;
    input.selectionEnd = start + value.length;
}
