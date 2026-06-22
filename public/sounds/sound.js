// ── Ola Sound Manager — Sistema de Identidad Sonora ──────────────────────────
//
// CONCEPTO: "Ola" suena a ondas tranquilas, no a alarmas.
// Todos los sonidos usan osciladores sine/triangle con envolventes ADSR suaves.
// Paleta pentatónica (C5–E5–G5–A5) → sin disonancia, siempre agradable.
// Filtro pasa-bajos en todos los sonidos → calidez, nunca dureza.
//
// Frecuencias base:
//   C4  261.63 Hz — armónico grave suave
//   F4  349.23 Hz — descenso cálido (error)
//   A4  440.00 Hz — error suave
//   C5  523.25 Hz — tónica de marca
//   D5  587.33 Hz — movimiento suave
//   E5  659.25 Hz — tercera mayor, cálida
//   G5  783.99 Hz — quinta perfecta, estable
//   A5  880.00 Hz — reacción brillante
//   C6 1046.50 Hz — micro-pico muy breve

const KEY_ENABLED = 'ola-sound-enabled';
const KEY_VOLUME  = 'ola-sound-volume';

let _ctx     = null;
let _enabled = true;
let _volume  = 0.70;

// Cooldown por tipo (ms) — evita spam en ráfagas del mismo tipo
const CD = { incoming: 500, outgoing: 280, mention: 600,
             error: 600, online: 1200, offline: 1200,
             reaction: 350, popup: 180 };
const _cdAt = {};               // { tipo: timestamp }

// ── Inicialización ────────────────────────────────────────────────────────────

export function initSoundManager() {
    try {
        const e = localStorage.getItem(KEY_ENABLED);
        const v = localStorage.getItem(KEY_VOLUME);
        _enabled = e === null ? true : e === 'true';
        _volume  = v === null ? 0.70 : Math.min(1, Math.max(0, parseFloat(v) || 0.70));
    } catch { /* sin localStorage */ }
}

// Debe llamarse dentro de un gesto del usuario (clic, submit).
// Crea o reanuda el AudioContext bloqueado por políticas de autoplay.
export function unlockAudio() {
    try {
        if (!_ctx) {
            _ctx = new (window.AudioContext || window.webkitAudioContext)();
        } else if (_ctx.state === 'suspended') {
            _ctx.resume();
        }
    } catch { _ctx = null; }
}

// ── Control público ───────────────────────────────────────────────────────────

export function setSoundEnabled(enabled) {
    _enabled = Boolean(enabled);
    try { localStorage.setItem(KEY_ENABLED, String(_enabled)); } catch {}
}

export function isSoundEnabled() { return _enabled; }

export function setSoundVolume(v) {
    _volume = Math.min(1, Math.max(0, Number(v) || 0));
    try { localStorage.setItem(KEY_VOLUME, String(_volume)); } catch {}
}

export function getSoundVolume() { return _volume; }

// ── Infraestructura interna ───────────────────────────────────────────────────

function _ctx_() {
    if (!_ctx) {
        try {
            _ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch { return null; }
    }
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    return _ctx;
}

function _canPlay(type) {
    if (!_enabled) return false;
    const now = Date.now();
    if (_cdAt[type] && now - _cdAt[type] < (CD[type] ?? 200)) return false;
    return true;
}

function _mark(type) {
    _cdAt[type] = Date.now();
}

// Primitiva central: oscilador único con filtro LP y envolvente ADSR.
//
// opts:
//   waveform  — 'sine' | 'triangle'          default 'sine'
//   f0        — frecuencia inicio (Hz)        default 523.25
//   f1        — frecuencia fin (Hz, opcional) default null
//   vol       — volumen pico (0–1)            default 0.08
//   atk       — attack (s)                   default 0.012
//   sus       — sustain (s)                  default 0.04
//   rel       — release (s)                  default 0.13
//   lp        — freq del filtro pasa-bajos    default 2200
//   h0        — frecuencia armónico (Hz)      default null
//   hv        — volumen armónico              default 0
function _tone(opts = {}) {
    const ctx = _ctx_();
    if (!ctx) return;

    const {
        waveform = 'sine',
        f0  = 523.25,
        f1  = null,
        vol = 0.08,
        atk = 0.012,
        sus = 0.04,
        rel = 0.13,
        lp  = 2200,
        h0  = null,
        hv  = 0,
    } = opts;

    const t   = ctx.currentTime;
    const dur = atk + sus + rel;
    const sv  = vol * _volume;

    // Filtro pasa-bajos — suaviza la salida
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lp, t);
    filter.Q.setValueAtTime(0.4, t);
    filter.connect(ctx.destination);

    // Oscilador principal
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + atk + sus);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(sv, t + atk);
    gain.gain.setValueAtTime(sv, t + atk + sus);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.01);

    // Armónico opcional (muy suave, da cuerpo sin volumen)
    if (h0 !== null && hv > 0) {
        const ohv  = hv * _volume;
        const osc2 = ctx.createOscillator();
        const gn2  = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(h0, t);
        gn2.gain.setValueAtTime(0.0001, t);
        gn2.gain.linearRampToValueAtTime(ohv, t + atk);
        gn2.gain.setValueAtTime(ohv, t + atk + sus);
        gn2.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc2.connect(gn2);
        gn2.connect(filter);
        osc2.start(t);
        osc2.stop(t + dur + 0.01);
    }
}

// ── A) Mensaje recibido — ola ascendente C5 → E5, ~195 ms ────────────────────
export function playIncomingMessageSound() {
    if (!_canPlay('incoming')) return;
    _mark('incoming');
    _tone({ f0: 523.25, f1: 659.25, vol: 0.09, atk: 0.013, sus: 0.05, rel: 0.14,
            h0: 261.63, hv: 0.022, lp: 2400 });
}

// ── B) Mensaje enviado — confirmación discreta E5 → D5, ~115 ms ──────────────
export function playOutgoingMessageSound() {
    if (!_canPlay('outgoing')) return;
    _mark('outgoing');
    _tone({ f0: 659.25, f1: 587.33, vol: 0.052, atk: 0.010, sus: 0.022, rel: 0.09,
            lp: 1800 });
}

// ── C) Mención — firma Ola: pulso C5 → acorde E5+G5, ~255 ms ─────────────────
export function playMentionSound() {
    if (!_canPlay('mention')) return;
    _mark('mention');
    const ctx = _ctx_();
    if (!ctx) return;

    const t = ctx.currentTime;

    const note = (freq, start, dur, vol) => {
        const sv   = vol * _volume;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        const lp   = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, start);
        lp.Q.setValueAtTime(0.4, start);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(sv, start + 0.013);
        gain.gain.setValueAtTime(sv, start + 0.055);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain);
        gain.connect(lp);
        lp.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.01);
    };

    note(523.25, t,        0.13,  0.085);   // C5 — primer pulso
    note(659.25, t + 0.11, 0.155, 0.098);  // E5 — acorde
    note(783.99, t + 0.11, 0.155, 0.048);  // G5 — armónico del acorde
}

// ── D) Error suave — descenso A4 → F4, triangle, ~195 ms ─────────────────────
export function playSoftErrorSound() {
    if (!_canPlay('error')) return;
    _mark('error');
    _tone({ waveform: 'triangle', f0: 440, f1: 349.23, vol: 0.068,
            atk: 0.015, sus: 0.04, rel: 0.15, lp: 1200 });
}

// ── E) Usuario conectado — quinta ascendente C5 → G5, ~155 ms ────────────────
export function playUserOnlineSound() {
    if (!_canPlay('online')) return;
    _mark('online');
    _tone({ f0: 523.25, f1: 783.99, vol: 0.062, atk: 0.012, sus: 0.028, rel: 0.12,
            h0: 261.63, hv: 0.016, lp: 2000 });
}

// ── F) Usuario desconectado — quinta descendente G5 → C5, ~140 ms ────────────
export function playUserOfflineSound() {
    if (!_canPlay('offline')) return;
    _mark('offline');
    _tone({ f0: 783.99, f1: 523.25, vol: 0.045, atk: 0.011, sus: 0.022, rel: 0.11,
            lp: 1600 });
}

// ── G) Reacción — micro-feedback A5, ~88 ms ───────────────────────────────────
export function playReactionSound() {
    if (!_canPlay('reaction')) return;
    _mark('reaction');
    _tone({ f0: 880, f1: 1046.5, vol: 0.042, atk: 0.008, sus: 0.010, rel: 0.07,
            lp: 2200 });
}

// ── H) Popup / Menú — tono mínimo G5, ~68 ms ─────────────────────────────────
export function playPopupSound() {
    if (!_canPlay('popup')) return;
    _mark('popup');
    _tone({ f0: 783.99, vol: 0.026, atk: 0.006, sus: 0.008, rel: 0.055, lp: 1600 });
}
