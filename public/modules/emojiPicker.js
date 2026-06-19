// ── WRAPPER DEL SELECTOR DE EMOJIS ──────────────────────────────────────────
import { initEmojiPicker as _initPicker } from '../emoji/picker.js';

/**
 * Inicializa el selector de emojis usando los elementos del mapa principal.
 * Envuelve initEmojiPicker para que app.js no dependa directamente de la ruta
 * interna del picker.
 *
 * @param {{ emojiButton: HTMLElement, emojiPicker: HTMLElement, messageInput: HTMLInputElement }} elements
 */
export function setupEmojiPicker(elements) {
    _initPicker({
        button: elements.emojiButton,
        picker: elements.emojiPicker,
        input:  elements.messageInput
    });
}
