// Manager centralizado para popovers: solo uno abierto a la vez
let _activePopover = null;
let _cleanupFn = null;

export function closeActivePopover() {
    if (_cleanupFn) { _cleanupFn(); _cleanupFn = null; }
    if (_activePopover) {
        _activePopover.classList.add('hidden');
        _activePopover = null;
    }
}

/**
 * Crea un controlador de popover para un elemento dado.
 *
 * @param {{ el: HTMLElement, onClose?: () => void }} options
 * @returns {{ open: () => void, close: () => void, toggle: () => void }}
 */
export function createPopoverController({ el, onClose }) {
    function close() {
        if (_activePopover !== el) return;
        closeActivePopover();
        onClose?.();
    }

    function open() {
        if (_activePopover && _activePopover !== el) closeActivePopover();
        el.classList.remove('hidden');
        _activePopover = el;

        const onKeydown = (e) => { if (e.key === 'Escape') close(); };
        const onClickOutside = (e) => { if (!el.contains(e.target)) close(); };

        document.addEventListener('keydown', onKeydown);
        requestAnimationFrame(() => {
            document.addEventListener('click', onClickOutside, { once: true });
        });

        _cleanupFn = () => {
            document.removeEventListener('keydown', onKeydown);
            document.removeEventListener('click', onClickOutside);
        };
    }

    function toggle() {
        if (_activePopover === el) { close(); } else { open(); }
    }

    return { open, close, toggle };
}
