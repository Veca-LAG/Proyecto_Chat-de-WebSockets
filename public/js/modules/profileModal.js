import { renderAvatarContent, getInitialsFromName, escapeHtml } from './profile.js';

const MAX_AVATAR_BYTES = 400_000;
let _sendJsonFn = null;
let _currentProfile = null;
let _pendingAvatarData = undefined;

export function openProfileModal(profile, sendJson) {
    _sendJsonFn  = sendJson;
    _currentProfile = profile ? { ...profile } : null;
    _pendingAvatarData = undefined;

    const modal = document.getElementById('profileEditModal');
    if (!modal) return;

    _populateForm(profile);
    _updatePreview(profile);
    modal.classList.remove('hidden');
    document.getElementById('peDisplayName')?.focus();
}

export function closeProfileModal() {
    const modal = document.getElementById('profileEditModal');
    if (modal) modal.classList.add('hidden');
    _pendingAvatarData = undefined;
}

function _populateForm(profile) {
    _setVal('peDisplayName',  profile?.displayName  || '');
    _setVal('peBio',          profile?.bio          || '');
    _setVal('pePronouns',     profile?.pronouns     || '');
    _setVal('peCustomStatus', profile?.customStatus || '');
    _setVal('peStatusEmoji',  profile?.statusEmoji  || '');
    _setVal('peBannerColor',  profile?.bannerColor  || '#fbbf24');

    const av = document.getElementById('peAvatarPreview');
    if (av) renderAvatarContent(av, profile);

    _updateCharCount('peBio',          190);
    _updateCharCount('peCustomStatus', 80);
    _updateCharCount('pePronouns',     40);
    _updateCharCount('peDisplayName',  40);
}

function _setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function _updateCharCount(inputId, max) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(inputId + 'Count');
    if (!input || !counter) return;
    const len = (input.value || '').length;
    counter.textContent = `${len}/${max}`;
    counter.classList.toggle('char-count--warn', len > max * 0.85);
}

function _readForm() {
    return {
        displayName:  document.getElementById('peDisplayName')?.value  || '',
        bio:          document.getElementById('peBio')?.value          || '',
        pronouns:     document.getElementById('pePronouns')?.value     || '',
        customStatus: document.getElementById('peCustomStatus')?.value || '',
        statusEmoji:  document.getElementById('peStatusEmoji')?.value  || '',
        bannerColor:  document.getElementById('peBannerColor')?.value  || '#fbbf24',
        avatarData:   _pendingAvatarData !== undefined ? _pendingAvatarData : _currentProfile?.avatarData
    };
}

function _updatePreview(overrides) {
    const data = overrides ? { ..._readForm(), ...overrides } : _readForm();

    const pvBanner = document.getElementById('pvBanner');
    if (pvBanner) pvBanner.style.backgroundColor = data.bannerColor || '#fbbf24';

    const pvAvatar = document.getElementById('pvAvatar');
    if (pvAvatar) renderAvatarContent(pvAvatar, { avatarData: data.avatarData, displayName: data.displayName });

    const pvName = document.getElementById('pvDisplayName');
    if (pvName) pvName.textContent = data.displayName || _currentProfile?.username || '';

    const pvUsername = document.getElementById('pvUsername');
    if (pvUsername) pvUsername.textContent = '@' + (_currentProfile?.username || '');

    const pvStatus = document.getElementById('pvCustomStatus');
    if (pvStatus) {
        const txt = (data.statusEmoji ? data.statusEmoji + ' ' : '') + (data.customStatus || '');
        pvStatus.textContent = txt;
        pvStatus.style.display = txt.trim() ? '' : 'none';
    }

    const pvBio = document.getElementById('pvBio');
    if (pvBio) { pvBio.textContent = data.bio || ''; pvBio.style.display = data.bio ? '' : 'none'; }

    const pvPronouns = document.getElementById('pvPronouns');
    if (pvPronouns) { pvPronouns.textContent = data.pronouns || ''; pvPronouns.style.display = data.pronouns ? '' : 'none'; }
}

function _handleAvatarFile(file) {
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type)) {
        alert('Solo se permiten imágenes PNG, JPG o WebP.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = e.target.result;
        if (data.length > MAX_AVATAR_BYTES) {
            alert('La imagen es demasiado grande. Máximo ~300 KB.');
            return;
        }
        _pendingAvatarData = data;
        const av = document.getElementById('peAvatarPreview');
        if (av) renderAvatarContent(av, { avatarData: data });
        _updatePreview();
    };
    reader.readAsDataURL(file);
}

function _removeAvatar() {
    _pendingAvatarData = null;
    const av = document.getElementById('peAvatarPreview');
    if (av) {
        av.innerHTML = '';
        av.textContent = getInitialsFromName(_currentProfile?.displayName || _currentProfile?.username || '');
    }
    _updatePreview();
}

function _handleSave(e) {
    e.preventDefault();
    const data = _readForm();

    const payload = {
        displayName:    data.displayName,
        bio:            data.bio,
        pronouns:       data.pronouns,
        customStatus:   data.customStatus,
        statusEmoji:    data.statusEmoji,
        bannerColor:    data.bannerColor
    };

    if (_pendingAvatarData !== undefined) {
        payload.avatarData = _pendingAvatarData;
    }

    _sendJsonFn?.({ type: 'update_profile', payload, timestamp: new Date().toISOString() });
    closeProfileModal();
}

export function setupProfileModal(sendJson) {
    _sendJsonFn = sendJson;

    document.getElementById('peCloseBtn')?.addEventListener('click', closeProfileModal);
    document.getElementById('peCancelBtn')?.addEventListener('click', closeProfileModal);
    document.getElementById('profileEditForm')?.addEventListener('submit', _handleSave);

    document.getElementById('peAvatarInput')?.addEventListener('change', (e) => {
        _handleAvatarFile(e.target.files?.[0]);
    });

    document.getElementById('peChangeAvatarBtn')?.addEventListener('click', () => {
        document.getElementById('peAvatarInput')?.click();
    });

    document.getElementById('peRemoveAvatarBtn')?.addEventListener('click', _removeAvatar);

    ['peDisplayName', 'peBio', 'pePronouns', 'peCustomStatus', 'peStatusEmoji', 'peBannerColor'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            _updatePreview();
            _updateCharCount(id, { peDisplayName: 40, peBio: 190, pePronouns: 40, peCustomStatus: 80, peStatusEmoji: 10, peBannerColor: 0 }[id] || 0);
        });
    });

    document.getElementById('profileEditModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeProfileModal();
    });
}
