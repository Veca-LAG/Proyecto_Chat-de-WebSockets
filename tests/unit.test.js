'use strict';
/**
 * PRUEBAS UNITARIAS — sin DB ni Redis
 * Cubren todas las funciones puras del proyecto
 */

require('dotenv').config();
const assert = require('assert');

// ── Runner ────────────────────────────────────────────────────────────────────
const results = [];
async function test(name, fn) {
    const t = Date.now();
    try {
        await fn();
        results.push({ name, ok: true, ms: Date.now() - t });
        process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
    } catch (err) {
        results.push({ name, ok: false, ms: Date.now() - t, error: err.message });
        process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[2m→ ${err.message}\x1b[0m\n`);
    }
}
function section(title) { process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`); }

// ── Imports ───────────────────────────────────────────────────────────────────
const { sanitizeText, normalizeNickname }     = require('../src/utils/sanitize');
const { toPublicUser }                        = require('../src/utils/presence');
const { hashPassword, verifyPassword, validateRegisterPayload } = require('../src/modules/auth/auth.service');
const {
    normalizeTermForModeration, buildLooseWordRegex,
    normalizeTerms, fallbackModerationTerms, compileModerationRegexList
} = require('../src/modules/moderation/moderation.filter');
const { buildReplySnapshot, rowToMessage }    = require('../src/modules/messages/messages.service');
const { rowToProfile }                        = require('../src/modules/profiles/profiles.service');

// ─────────────────────────────────────────────────────────────────────────────
async function run() {

// ══ 1. sanitize.js ═══════════════════════════════════════════════════════════
section('1. utils/sanitize.js');

await test('sanitizeText — elimina etiquetas HTML', () => {
    assert.strictEqual(sanitizeText('<b>hola</b>', 100), 'hola');
    assert.strictEqual(sanitizeText('<script>alert(1)</script>texto', 100), 'alert(1)texto');
});
await test('sanitizeText — trunca al maxLength', () => {
    assert.strictEqual(sanitizeText('abcdef', 3), 'abc');
});
await test('sanitizeText — maneja null/undefined', () => {
    assert.strictEqual(sanitizeText(null, 10), '');
    assert.strictEqual(sanitizeText(undefined, 10), '');
});
await test('sanitizeText — hace trim', () => {
    assert.strictEqual(sanitizeText('  hola  ', 20), 'hola');
});
await test('normalizeNickname — convierte a minúsculas y trim', () => {
    assert.strictEqual(normalizeNickname('  JUAN  '), 'juan');
    assert.strictEqual(normalizeNickname('MiNick'), 'minick');
});
await test('normalizeNickname — maneja null/undefined', () => {
    assert.strictEqual(normalizeNickname(null), '');
    assert.strictEqual(normalizeNickname(undefined), '');
});

// ══ 2. moderation.filter.js ══════════════════════════════════════════════════
section('2. modules/moderation/moderation.filter.js');

await test('normalizeTermForModeration — elimina acentos', () => {
    assert.strictEqual(normalizeTermForModeration('pérro'), 'perro');
    assert.strictEqual(normalizeTermForModeration('camión'), 'camion');
});
await test('normalizeTermForModeration — convierte leet speak numérico (1=i, 3=e, 4=a, 0=o)', () => {
    const r = normalizeTermForModeration('p4nd3j4');
    assert.ok(r.includes('a') || r.includes('e'), `Resultado: ${r}`);
});
await test('normalizeTermForModeration — convierte @ y $', () => {
    const r = normalizeTermForModeration('@$df');
    assert.ok(r.startsWith('a') || r.startsWith('s'), `Resultado: ${r}`);
});
await test('normalizeTermForModeration — elimina caracteres no alfanuméricos', () => {
    assert.strictEqual(normalizeTermForModeration('p.u.t.a'), 'puta');
});
await test('buildLooseWordRegex — retorna null para términos cortos (<3 chars)', () => {
    assert.strictEqual(buildLooseWordRegex('ab'), null);
    assert.strictEqual(buildLooseWordRegex(''), null);
});
await test('buildLooseWordRegex — detecta palabra exacta', () => {
    const regex = buildLooseWordRegex('puta');
    assert.ok(regex, 'regex no debe ser null');
    regex.lastIndex = 0;
    assert.ok(regex.test('esto es puta mentira'), 'debe detectar "puta"');
});
await test('buildLooseWordRegex — detecta repetición de caracteres (putoooo)', () => {
    const regex = buildLooseWordRegex('puto');
    assert.ok(regex, 'regex no debe ser null');
    regex.lastIndex = 0;
    assert.ok(regex.test('es un putoooo'), 'debe detectar "putoooo"');
});
await test('buildLooseWordRegex — detecta separadores (p.u.t.a)', () => {
    const regex = buildLooseWordRegex('puta');
    assert.ok(regex, 'regex no debe ser null');
    regex.lastIndex = 0;
    assert.ok(regex.test('eres una p.u.t.a'), 'debe detectar "p.u.t.a"');
});
await test('buildLooseWordRegex — detecta leet speak (p4nd3j4)', () => {
    const regex = buildLooseWordRegex('pendeja');
    assert.ok(regex, 'regex no debe ser null');
    regex.lastIndex = 0;
    assert.ok(regex.test('eres una p3nd3j4'), 'debe detectar "p3nd3j4" (3→e, 4→a)');
});
await test('normalizeTerms — deduplica términos por normalized+country_code', () => {
    const rows = [
        { term: 'puta', normalized_term: 'puta', country_code: 'ALL' },
        { term: 'puta', normalized_term: 'puta', country_code: 'ALL' },
    ];
    const result = normalizeTerms(rows);
    assert.strictEqual(result.length, 1);
});
await test('normalizeTerms — ordena por longitud descendente', () => {
    const rows = [
        { term: 'ab',    normalized_term: 'abc',    country_code: 'ALL' },
        { term: 'abcde', normalized_term: 'abcde',  country_code: 'ALL' },
        { term: 'abcd',  normalized_term: 'abcd',   country_code: 'ALL' },
    ];
    const result = normalizeTerms(rows);
    assert.ok(result[0].normalizedTerm.length >= result[result.length - 1].normalizedTerm.length);
});
await test('fallbackModerationTerms — retorna lista no vacía con términos conocidos', () => {
    const terms = fallbackModerationTerms();
    assert.ok(terms.length > 0, 'debe tener términos');
    const words = terms.map(t => t.term);
    assert.ok(words.includes('puta') || words.includes('mierda'), 'debe incluir palabras conocidas');
});
await test('compileModerationRegexList — filtra términos sin regex válida', () => {
    const terms = [
        { term: 'ok', normalizedTerm: 'ok' },   // muy corto, dará null
        { term: 'puta', normalizedTerm: 'puta' } // válido
    ];
    const list = compileModerationRegexList(terms);
    assert.ok(list.every(item => item.regex instanceof RegExp));
});

// ══ 3. auth.service.js ═══════════════════════════════════════════════════════
section('3. modules/auth/auth.service.js');

await test('hashPassword — retorna objeto con salt y hash', () => {
    const { salt, hash } = hashPassword('mipassword123');
    assert.ok(salt && salt.length > 0, 'salt no debe estar vacío');
    assert.ok(hash && hash.length > 0, 'hash no debe estar vacío');
});
await test('hashPassword — dos llamadas producen hashes distintos (salt aleatorio)', () => {
    const { hash: h1 } = hashPassword('mismo');
    const { hash: h2 } = hashPassword('mismo');
    assert.notStrictEqual(h1, h2);
});
await test('verifyPassword — acepta contraseña correcta', () => {
    const { salt, hash } = hashPassword('MiPass123');
    assert.ok(verifyPassword('MiPass123', { passwordSalt: salt, passwordHash: hash }));
});
await test('verifyPassword — rechaza contraseña incorrecta', () => {
    const { salt, hash } = hashPassword('MiPass123');
    assert.ok(!verifyPassword('OtraPass', { passwordSalt: salt, passwordHash: hash }));
});
await test('verifyPassword — retorna false con campos faltantes', () => {
    assert.ok(!verifyPassword('pass', {}));
    assert.ok(!verifyPassword('pass', null));
});
await test('validateRegisterPayload — acepta payload válido', () => {
    const r = validateRegisterPayload({ firstName: 'Juan', lastName: 'Pérez', nickname: 'juanito', password: 'abc123', passwordConfirm: 'abc123' });
    assert.ok(r.valid);
    assert.strictEqual(r.data.nickname, 'juanito');
});
await test('validateRegisterPayload — rechaza contraseña corta', () => {
    const r = validateRegisterPayload({ firstName: 'A', lastName: 'B', nickname: 'nick', password: '12', passwordConfirm: '12' });
    assert.ok(!r.valid);
    assert.ok(r.error.includes('contraseña'));
});
await test('validateRegisterPayload — rechaza contraseñas distintas', () => {
    const r = validateRegisterPayload({ firstName: 'A', lastName: 'B', nickname: 'nick', password: 'abc123', passwordConfirm: 'xyz789' });
    assert.ok(!r.valid);
    assert.ok(r.error.includes('coinciden'));
});
await test('validateRegisterPayload — rechaza campos vacíos', () => {
    const r = validateRegisterPayload({ firstName: '', lastName: '', nickname: '', password: 'abc123' });
    assert.ok(!r.valid);
    assert.ok(r.error.includes('obligatorios'));
});

// ══ 4. messages.service.js (funciones puras) ═════════════════════════════════
section('4. modules/messages/messages.service.js  (funciones puras)');

await test('buildReplySnapshot — retorna nulls para payload vacío', () => {
    const snap = buildReplySnapshot({});
    assert.strictEqual(snap.replyToId, null);
    assert.strictEqual(snap.replyAuthor, null);
    assert.strictEqual(snap.replyText, null);
    assert.strictEqual(snap.replyTo, null);
});
await test('buildReplySnapshot — extrae datos de replyTo anidado', () => {
    const snap = buildReplySnapshot({
        replyTo: { id: 'uuid-123', nickname: 'ana', text: 'hola' }
    });
    assert.strictEqual(snap.replyAuthor, 'ana');
    assert.strictEqual(snap.replyText, 'hola');
    assert.ok(snap.replyTo !== null);
});
await test('buildReplySnapshot — extrae datos de campos planos', () => {
    const snap = buildReplySnapshot({ replyToId: 'uuid-456', replyTo: { nickname: 'bob', text: 'ey' } });
    assert.strictEqual(snap.replyToId, 'uuid-456');
});
await test('rowToMessage — mapea fila DB a objeto mensaje', () => {
    const row = {
        id: 'msg-1', from_id: 'user-1', from_nickname: 'pepe',
        text: 'hola', text_original: 'hola', text_censored: 'hola',
        reply_to_id: null, reply_text: null, reply_author: null,
        is_forwarded: false, forwarded_from_id: null,
        deleted_for_all: false, deleted_by: null,
        created_at: new Date('2024-01-01')
    };
    const msg = rowToMessage(row, 'global', true);
    assert.strictEqual(msg.id, 'msg-1');
    assert.strictEqual(msg.from, 'pepe');
    assert.strictEqual(msg.kind, 'global');
    assert.strictEqual(msg.deletedForAll, false);
});
await test('rowToMessage — usa texto censurado cuando censorshipEnabled=true', () => {
    const row = {
        id: 'msg-2', from_id: 'u', from_nickname: 'n',
        text: 'censurado', text_original: 'original', text_censored: 'censurado',
        reply_to_id: null, reply_text: null, is_forwarded: false,
        deleted_for_all: false, deleted_by: null, created_at: new Date()
    };
    const msg = rowToMessage(row, 'global', true);
    assert.strictEqual(msg.text, 'censurado');
});
await test('rowToMessage — usa texto original cuando censorshipEnabled=false', () => {
    const row = {
        id: 'msg-3', from_id: 'u', from_nickname: 'n',
        text: 'censurado', text_original: 'original', text_censored: 'censurado',
        reply_to_id: null, reply_text: null, is_forwarded: false,
        deleted_for_all: false, deleted_by: null, created_at: new Date()
    };
    const msg = rowToMessage(row, 'global', false);
    assert.strictEqual(msg.text, 'original');
});
await test('rowToMessage — retorna texto vacío para mensajes eliminados', () => {
    const row = {
        id: 'msg-4', from_id: 'u', from_nickname: 'n',
        text: '', text_original: 'secreto', text_censored: 'secreto',
        reply_to_id: null, reply_text: null, is_forwarded: false,
        deleted_for_all: true, deleted_by: 'u', created_at: new Date()
    };
    const msg = rowToMessage(row, 'global', true);
    assert.strictEqual(msg.text, '');
    assert.strictEqual(msg.deletedForAll, true);
});

// ══ 5. profiles.service.js (funciones puras) ═════════════════════════════════
section('5. modules/profiles/profiles.service.js  (funciones puras)');

await test('rowToProfile — mapea todos los campos correctamente', () => {
    const row = {
        user_id: 'uid-1', display_name: 'Juan', username: 'juanito',
        avatar_url: null, avatar_data: null, banner_color: '#ff0000',
        bio: 'Mi bio', pronouns: 'él', custom_status: 'Ocupado',
        presence_status: 'away', status_emoji: '🔥',
        profile_effect: '', nameplate_color: '', updated_at: new Date()
    };
    const p = rowToProfile(row, 'juanito');
    assert.strictEqual(p.userId, 'uid-1');
    assert.strictEqual(p.displayName, 'Juan');
    assert.strictEqual(p.presenceStatus, 'away');
    assert.strictEqual(p.bio, 'Mi bio');
    assert.strictEqual(p.bannerColor, '#ff0000');
});
await test('rowToProfile — usa fallbackNickname cuando display_name está vacío', () => {
    const row = {
        user_id: 'uid-2', display_name: '', username: '',
        avatar_url: null, avatar_data: null, banner_color: '#fbbf24',
        bio: '', pronouns: '', custom_status: '', presence_status: 'online',
        status_emoji: '', profile_effect: '', nameplate_color: '', updated_at: new Date()
    };
    const p = rowToProfile(row, 'nick_fallback');
    assert.strictEqual(p.displayName, 'nick_fallback');
    assert.strictEqual(p.username, 'nick_fallback');
});
await test('rowToProfile — color de banner por defecto #fbbf24', () => {
    const row = {
        user_id: 'uid-3', display_name: 'A', username: 'a',
        banner_color: '', bio: '', pronouns: '', custom_status: '',
        presence_status: 'online', status_emoji: '', profile_effect: '',
        nameplate_color: '', updated_at: new Date()
    };
    const p = rowToProfile(row);
    assert.strictEqual(p.bannerColor, '#fbbf24');
});

// ══ 6. utils/presence.js — toPublicUser ══════════════════════════════════════
section('6. utils/presence.js  —  toPublicUser');

await test('toPublicUser — mapea fila DB snake_case a objeto público', () => {
    const row = { id: 'u1', code: 'USR-123', first_name: 'Ana', last_name: 'López', nickname: 'ana' };
    const pub = toPublicUser(row, true);
    assert.strictEqual(pub.id, 'u1');
    assert.strictEqual(pub.firstName, 'Ana');
    assert.strictEqual(pub.isOnline, true);
});
await test('toPublicUser — acepta campos camelCase (registro interno)', () => {
    const row = { id: 'u2', code: 'USR-456', firstName: 'Bob', lastName: 'Smith', nickname: 'bob' };
    const pub = toPublicUser(row, false);
    assert.strictEqual(pub.firstName, 'Bob');
    assert.strictEqual(pub.isOnline, false);
});
await test('toPublicUser — retorna null para fila null', () => {
    assert.strictEqual(toPublicUser(null), null);
});

// ═════════════════════════════════════════════════════════════════════════════
const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;

console.log('\n' + '─'.repeat(56));
console.log(`\x1b[1mResultado unit:\x1b[0m  \x1b[32m${pass} ✓\x1b[0m  ${fail > 0 ? `\x1b[31m${fail} ✗\x1b[0m` : ''}`);
console.log('─'.repeat(56));

process.exitCode = fail > 0 ? 1 : 0;

}

run().catch(err => { console.error(err); process.exit(1); });
