export function isMobile() {
    return window.matchMedia('(max-width: 680px)').matches;
}

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
