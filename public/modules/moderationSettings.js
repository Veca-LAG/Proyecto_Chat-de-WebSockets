// ── CONFIGURACIÓN DE MODERACIÓN / CENSURA ───────────────────────────────────

/**
 * Actualiza el texto del botón de censura según el estado actual.
 *
 * @param {HTMLElement|null} btn
 * @param {boolean} enabled
 */
export function updateCensorshipLabel(btn, enabled) {
    if (!btn) return;
    btn.textContent = enabled ? 'Censura: activada' : 'Censura: desactivada';
}

/**
 * Conecta el botón de censura con el estado local y el servidor.
 * Llama a updateCensorshipLabel para sincronizar el texto inicial.
 *
 * @param {{ toggleCensorshipButton: HTMLElement|null }} elements
 * @param {{ censorshipEnabled: boolean }} state
 * @param {(msg: object) => void} sendJson
 */
export function setupModerationUI(elements, state, sendJson) {
    const btn = elements.toggleCensorshipButton;
    updateCensorshipLabel(btn, state.censorshipEnabled);
    if (!btn) return;

    btn.addEventListener('click', () => {
        state.censorshipEnabled = !state.censorshipEnabled;
        updateCensorshipLabel(btn, state.censorshipEnabled);
        sendJson({
            type: 'toggle_censorship',
            payload: { enabled: state.censorshipEnabled },
            timestamp: new Date().toISOString()
        });
    });
}
