// ── DETECCIÓN DE MÓVIL Y LONGPRESS ──────────────────────────────────────────

/**
 * Retorna true cuando el viewport cae dentro del breakpoint móvil (≤ 680 px).
 * @returns {boolean}
 */
export function isMobile() {
    return window.matchMedia('(max-width: 680px)').matches;
}

/**
 * Adjunta un listener de long-press a un elemento.
 * El callback solo se dispara si el puntero no se movió durante el retraso.
 *
 * @param {HTMLElement} element Elemento que recibe el gesto.
 * @param {(event: PointerEvent) => void} onLongPress Callback al activarse.
 * @param {number} [delayMs=560] Milisegundos hasta disparar.
 */
export function attachLongPress(element, onLongPress, delayMs = 560) {
    let timer = null;
    let moved = false;

    element.addEventListener('pointerdown', (event) => {
        if (!isMobile()) return;
        moved = false;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (!moved) onLongPress(event);
        }, delayMs);
    });

    element.addEventListener('pointermove', () => {
        moved = true;
        clearTimeout(timer);
    });

    ['pointerup', 'pointercancel', 'mouseleave'].forEach((name) => {
        element.addEventListener(name, () => clearTimeout(timer));
    });
}
