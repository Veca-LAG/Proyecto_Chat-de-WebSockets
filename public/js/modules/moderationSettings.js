export function updateCensorshipLabel(btn, enabled) {
    if (!btn) return;
    btn.textContent = enabled ? 'Censura: activada' : 'Censura: desactivada';
}

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
