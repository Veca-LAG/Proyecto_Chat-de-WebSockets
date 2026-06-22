export const profileCache = new Map(); // userId → profile

export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

export function getInitialsFromName(name) {
    return String(name || 'U')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(p => p.charAt(0).toUpperCase())
        .join('') || 'U';
}

export const PRESENCE_CONFIG = {
    online:    { label: 'En línea',    cssClass: 'presence-online',    icon: '●' },
    away:      { label: 'Ausente',     cssClass: 'presence-away',      icon: '🌙' },
    dnd:       { label: 'No molestar', cssClass: 'presence-dnd',       icon: '⛔' },
    invisible: { label: 'Invisible',   cssClass: 'presence-invisible', icon: '○' }
};

export function upsertProfile(profile) {
    if (!profile?.userId) return;
    const prev = profileCache.get(profile.userId) || {};
    profileCache.set(profile.userId, { ...prev, ...profile });
    applyProfileToUserElements(profile.userId);
}

export function getProfile(userId) {
    return profileCache.get(userId) ?? null;
}

export function getProfileByNickname(nickname) {
    const lc = String(nickname).toLowerCase();
    for (const p of profileCache.values()) {
        if ((p.username || '').toLowerCase() === lc) return p;
    }
    return null;
}

export function renderAvatarContent(el, profile) {
    if (!el) return;
    if (profile?.avatarData) {
        el.textContent = '';
        let img = el.querySelector('img.avatar-img');
        if (!img) {
            img = document.createElement('img');
            img.className = 'avatar-img';
            img.alt = '';
            el.appendChild(img);
        }
        img.src = profile.avatarData;
    } else {
        el.innerHTML = '';
        el.textContent = getInitialsFromName(profile?.displayName || profile?.username || '');
    }
}

export function applyPresenceDot(dotEl, status) {
    if (!dotEl) return;
    dotEl.className = 'presence-dot';
    dotEl.classList.add(`presence-dot--${status || 'online'}`);
    dotEl.title = PRESENCE_CONFIG[status]?.label ?? (status === 'offline' ? 'Desconectado' : 'En línea');
}

export function applyProfileToUserElements(userId) {
    const profile = profileCache.get(userId);
    if (!profile) return;

    document.querySelectorAll(`[data-user-id="${userId}"]`).forEach(el => {
        const avatarEl = el.classList.contains('up-avatar') ? el : el.querySelector('.up-avatar');
        if (avatarEl) renderAvatarContent(avatarEl, profile);

        const nameEl = el.querySelector('[data-pf="display-name"]');
        if (nameEl) nameEl.textContent = profile.displayName || profile.username || '';

        const statusEl = el.querySelector('[data-pf="custom-status"]');
        if (statusEl) {
            statusEl.textContent = (profile.statusEmoji ? profile.statusEmoji + ' ' : '') + (profile.customStatus || '');
        }

        const dotEl = el.querySelector('.presence-dot');
        if (dotEl) applyPresenceDot(dotEl, profile.presenceStatus);

        const bannerEl = el.querySelector('[data-pf="banner"]');
        if (bannerEl) bannerEl.style.backgroundColor = profile.bannerColor || '#fbbf24';
    });
}

let _quickPopupOpen = false;

export function openQuickProfile(profile, anchorEl, onEditProfile, onChangeStatus, sendJson) {
    closeQuickProfile();

    const popup = document.getElementById('profileQuickPopup');
    if (!popup) return;

    const banner = popup.querySelector('[data-pf="banner"]');
    if (banner) banner.style.backgroundColor = profile?.bannerColor || '#fbbf24';

    const avatarEl = popup.querySelector('.up-avatar');
    if (avatarEl) renderAvatarContent(avatarEl, profile);

    const nameEl = popup.querySelector('[data-pf="display-name"]');
    if (nameEl) nameEl.textContent = escapeHtml(profile?.displayName || profile?.username || '');

    const usernameEl = popup.querySelector('[data-pf="username"]');
    if (usernameEl) usernameEl.textContent = '@' + (profile?.username || '');

    const cstatus = popup.querySelector('[data-pf="custom-status"]');
    if (cstatus) {
        const txt = (profile?.statusEmoji ? profile.statusEmoji + ' ' : '') + (profile?.customStatus || '');
        cstatus.textContent = txt;
        cstatus.style.display = txt.trim() ? '' : 'none';
    }

    const dot = popup.querySelector('.presence-dot');
    if (dot) applyPresenceDot(dot, profile?.presenceStatus || 'online');

    const statusLabel = popup.querySelector('[data-pf="presence-label"]');
    if (statusLabel) statusLabel.textContent = PRESENCE_CONFIG[profile?.presenceStatus || 'online']?.label || 'En línea';

    const editBtn = popup.querySelector('#popupEditProfileBtn');
    if (editBtn) {
        editBtn.onclick = () => { closeQuickProfile(); onEditProfile?.(); };
    }

    const statusRow = popup.querySelector('#popupStatusRow');
    if (statusRow) {
        statusRow.onclick = (e) => { e.stopPropagation(); openStatusMenu(profile?.presenceStatus, statusRow, sendJson); };
    }

    popup.classList.remove('hidden');
    _quickPopupOpen = true;

    requestAnimationFrame(() => {
        document.addEventListener('click', _closeQuickOnOutside, { once: true });
    });
}

function _closeQuickOnOutside(e) {
    const popup = document.getElementById('profileQuickPopup');
    if (popup && !popup.contains(e.target)) {
        closeQuickProfile();
    } else if (popup) {
        document.addEventListener('click', _closeQuickOnOutside, { once: true });
    }
}

export function closeQuickProfile() {
    const popup = document.getElementById('profileQuickPopup');
    if (popup) popup.classList.add('hidden');
    closeStatusMenu();
    _quickPopupOpen = false;
}

// Statuses que muestran sub-menú de duración
const TIMED_STATUSES = new Set(['away', 'dnd']);

const DURATION_OPTIONS = [
    { label: 'Durante 15 minutos', ms: 15 * 60 * 1000 },
    { label: 'Durante 1 hora',     ms:      60 * 60 * 1000 },
    { label: 'Durante 8 horas',    ms:  8 * 60 * 60 * 1000 },
    { label: 'Durante 24 horas',   ms: 24 * 60 * 60 * 1000 },
    { label: 'Durante 3 días',     ms:  3 * 24 * 60 * 60 * 1000 },
    { label: 'Siempre',            ms: null },
];

function _positionMenu(menu, anchorEl, side = 'top') {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    if (side === 'top') {
        menu.style.left   = `${rect.left}px`;
        menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        menu.style.top    = '';
    } else {
        // 'right' — aparece a la derecha del menú principal
        menu.style.top    = `${rect.top}px`;
        menu.style.left   = `${rect.right + 4}px`;
        menu.style.bottom = '';
    }
    requestAnimationFrame(() => {
        const mr = menu.getBoundingClientRect();
        if (mr.right > window.innerWidth - 8) {
            menu.style.left = `${window.innerWidth - mr.width - 8}px`;
        }
        if (mr.bottom > window.innerHeight - 8) {
            menu.style.top  = `${window.innerHeight - mr.height - 8}px`;
            menu.style.bottom = '';
        }
        if (mr.top < 8) {
            if (side === 'top') {
                menu.style.bottom = '';
                menu.style.top    = `${rect.bottom + 4}px`;
            } else {
                menu.style.top = '8px';
            }
        }
    });
}

function openPresenceSubMenu(status, itemEl, sendJson) {
    const sub = document.getElementById('presenceSubMenu');
    if (!sub) return;

    sub.innerHTML = '';
    DURATION_OPTIONS.forEach(({ label, ms }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'presence-menu-item';
        btn.textContent = label;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendJson?.({ type: 'update_presence_status', payload: { presenceStatus: status }, timestamp: new Date().toISOString() });
            document.dispatchEvent(new CustomEvent('ola:presence-timer-set', { detail: { status, ms } }));
            sub.classList.add('hidden');
            document.getElementById('presenceMenu')?.classList.add('hidden');
            closeStatusMenu();
        });
        sub.appendChild(btn);
    });

    sub.classList.remove('hidden');
    _positionMenu(sub, itemEl, 'right');

    requestAnimationFrame(() => {
        document.addEventListener('click', _closeSubMenuOnOutside, { once: true });
    });
}

function _closeSubMenuOnOutside(e) {
    const sub = document.getElementById('presenceSubMenu');
    const main = document.getElementById('presenceMenu');
    if (!sub) return;
    if (!sub.contains(e.target) && !main?.contains(e.target)) {
        sub.classList.add('hidden');
    } else {
        document.addEventListener('click', _closeSubMenuOnOutside, { once: true });
    }
}

export function openStatusMenu(currentStatus, anchorEl, sendJson) {
    const menu = document.getElementById('presenceMenu');
    if (!menu) return;
    document.getElementById('presenceSubMenu')?.classList.add('hidden');

    menu.innerHTML = '';

    Object.entries(PRESENCE_CONFIG).forEach(([status, cfg]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'presence-menu-item' + (status === currentStatus ? ' active' : '');

        const dot = document.createElement('span');
        dot.className = `presence-dot presence-dot--${status}`;

        const label = document.createElement('span');
        label.style.flex = '1';
        label.textContent = cfg.label;

        btn.append(dot, label);

        if (TIMED_STATUSES.has(status)) {
            const chevron = document.createElement('span');
            chevron.className = 'pqp-chevron';
            chevron.textContent = '›';
            btn.append(chevron);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openPresenceSubMenu(status, btn, sendJson);
            });
        } else {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                sendJson?.({ type: 'update_presence_status', payload: { presenceStatus: status }, timestamp: new Date().toISOString() });
                document.dispatchEvent(new CustomEvent('ola:presence-timer-set', { detail: { status, ms: null } }));
                menu.classList.add('hidden');
                closeStatusMenu();
            });
        }

        menu.appendChild(btn);
    });

    menu.classList.remove('hidden');
    _positionMenu(menu, anchorEl, 'top');

    requestAnimationFrame(() => {
        document.addEventListener('click', _closeMenuOnOutside, { once: true });
    });
}

function _closeMenuOnOutside(e) {
    const menu = document.getElementById('presenceMenu');
    if (menu && !menu.contains(e.target)) {
        menu.classList.add('hidden');
    } else if (menu) {
        document.addEventListener('click', _closeMenuOnOutside, { once: true });
    }
}

export function closeStatusMenu() {
    document.getElementById('presenceMenu')?.classList.add('hidden');
    document.getElementById('presenceSubMenu')?.classList.add('hidden');
}

export function showUserProfileCard(profile, anchorEl) {
    if (!profile) return;
    const card = document.getElementById('userProfileCard');
    if (!card) return;

    const banner = card.querySelector('[data-pf="banner"]');
    if (banner) banner.style.backgroundColor = profile.bannerColor || '#fbbf24';

    const av = card.querySelector('.up-avatar');
    if (av) renderAvatarContent(av, profile);

    const nm = card.querySelector('[data-pf="display-name"]');
    if (nm) nm.textContent = profile.displayName || profile.username || '';

    const un = card.querySelector('[data-pf="username"]');
    if (un) un.textContent = '@' + (profile.username || '');

    const bio = card.querySelector('[data-pf="bio"]');
    if (bio) { bio.textContent = profile.bio || ''; bio.style.display = profile.bio ? '' : 'none'; }

    const cs = card.querySelector('[data-pf="custom-status"]');
    if (cs) {
        const txt = (profile.statusEmoji ? profile.statusEmoji + ' ' : '') + (profile.customStatus || '');
        cs.textContent = txt;
        cs.style.display = txt.trim() ? '' : 'none';
    }

    const dot = card.querySelector('.presence-dot');
    if (dot) applyPresenceDot(dot, profile.presenceStatus || 'online');

    card.classList.remove('hidden');

    requestAnimationFrame(() => {
        document.addEventListener('click', (e) => {
            if (!card.contains(e.target)) card.classList.add('hidden');
        }, { once: true });
    });
}
