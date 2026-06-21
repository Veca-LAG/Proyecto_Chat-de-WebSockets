'use strict';
/**
 * PRUEBAS DE INTEGRACIÓN — requieren PostgreSQL y Redis activos
 * Prueban funciones que tocan la base de datos y el caché de moderación
 */

require('dotenv').config();
const assert = require('assert');
const { randomUUID } = require('crypto');

// ── Runner ────────────────────────────────────────────────────────────────────
const results = [];
async function test(name, fn) {
    const t = Date.now();
    try {
        await fn();
        results.push({ name, ok: true, ms: Date.now() - t });
        process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}  \x1b[2m(${Date.now() - t}ms)\x1b[0m\n`);
    } catch (err) {
        results.push({ name, ok: false, ms: Date.now() - t, error: err.message });
        process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[2m→ ${err.message}\x1b[0m\n`);
    }
}
function section(title) { process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`); }

// ── Imports ───────────────────────────────────────────────────────────────────
const pool = require('../src/db/pool');
const { loadModerationTerms, censorText, moderateMessageText } = require('../src/modules/moderation/moderation.service');
const { getUserModerationPreference, setUserModerationPreference, saveModerationAudit } = require('../src/modules/moderation/moderation.repository');
const { findUserById, findUserByNickname, generateUserCode, createSession, findUserBySessionToken, removeSession } = require('../src/modules/auth/auth.repository');
const { hashPassword }  = require('../src/modules/auth/auth.service');
const { getOrCreateProfile } = require('../src/modules/profiles/profiles.service');
const { normalizeNickname } = require('../src/utils/sanitize');

// ── Helpers de test ───────────────────────────────────────────────────────────
const TEST_PREFIX = `tst_${Date.now().toString(36)}_`;

async function createTestUser(nickname) {
    const { salt, hash } = hashPassword('Test1234!');
    const id   = randomUUID();
    const code = `USR-T${Math.floor(100000 + Math.random() * 900000)}`;
    const nick = TEST_PREFIX + nickname;
    await pool.query(
        `INSERT INTO users(id,code,first_name,last_name,nickname,nickname_normalized,password_salt,password_hash,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
        [id, code, 'Test', 'User', nick, normalizeNickname(nick), salt, hash]
    );
    return { id, nickname: nick };
}

async function cleanup() {
    await pool.query(`DELETE FROM users WHERE nickname LIKE $1`, [TEST_PREFIX + '%']);
}

// ─────────────────────────────────────────────────────────────────────────────
async function run() {

// ══ 1. Moderación — carga y censura ══════════════════════════════════════════
section('1. Moderación — carga desde PostgreSQL');

await test('loadModerationTerms — carga términos y retorna caché con versión > 0', async () => {
    const cache = await loadModerationTerms();
    assert.ok(cache.version > 0, `versión=${cache.version}`);
    assert.ok(Array.isArray(cache.terms), 'terms debe ser array');
    assert.ok(Array.isArray(cache.regexList), 'regexList debe ser array');
    assert.ok(cache.terms.length > 0, 'debe tener al menos un término');
    assert.ok(cache.loadedAt instanceof Date, 'loadedAt debe ser Date');
});

await test('censorText — censura palabras conocidas (puta, mierda)', () => {
    const r1 = censorText('esto es una puta mierda');
    assert.ok(r1.matchedTerms.length > 0, 'debe detectar términos');
    assert.ok(r1.censoredText.includes('*'), 'debe censurar con *');
    assert.ok(r1.originalText.includes('puta'), 'originalText intacto');
});

await test('censorText — no censura texto limpio', () => {
    const r = censorText('hola buenas tardes amigo');
    assert.strictEqual(r.matchedTerms.length, 0);
    assert.strictEqual(r.censoredText, 'hola buenas tardes amigo');
});

await test('censorText — detecta evasión con repetición (putoooo)', () => {
    const r = censorText('eres un putoooo');
    assert.ok(r.matchedTerms.length > 0, `matchedTerms: ${JSON.stringify(r.matchedTerms)}`);
});

await test('censorText — detecta evasión con puntos (p.u.t.a)', () => {
    const r = censorText('eres una p.u.t.a');
    assert.ok(r.matchedTerms.length > 0, `matchedTerms: ${JSON.stringify(r.matchedTerms)}`);
});

await test('moderateMessageText — retorna textOriginal y textCensored', () => {
    const r = moderateMessageText('que puta vida');
    assert.ok(r.textOriginal.includes('puta'));
    assert.ok(r.textCensored.includes('*'));
    assert.ok(Array.isArray(r.matchedTerms));
});

section('2. Moderación — preferencias de usuario');

await test('getUserModerationPreference — retorna true para usuario inexistente', async () => {
    const result = await getUserModerationPreference(randomUUID());
    assert.strictEqual(result, true);
});

await test('setUserModerationPreference + getUserModerationPreference — roundtrip', async () => {
    const { id } = await createTestUser('modpref');
    await setUserModerationPreference(id, false);
    const pref = await getUserModerationPreference(id);
    assert.strictEqual(pref, false);
    await setUserModerationPreference(id, true);
    const pref2 = await getUserModerationPreference(id);
    assert.strictEqual(pref2, true);
});

await test('saveModerationAudit — no lanza error con términos válidos', async () => {
    const { id } = await createTestUser('audit');
    await assert.doesNotReject(
        saveModerationAudit({ messageId: randomUUID(), userId: id, kind: 'global', matchedTerms: ['puta'] })
    );
});

await test('saveModerationAudit — no lanza error con matchedTerms vacío (no inserta)', async () => {
    await assert.doesNotReject(
        saveModerationAudit({ messageId: randomUUID(), userId: null, kind: 'test', matchedTerms: [] })
    );
});

// ══ 2. Auth repository ════════════════════════════════════════════════════════
section('3. Auth — repository');

await test('findUserById — retorna null para UUID inexistente', async () => {
    const user = await findUserById(randomUUID());
    assert.strictEqual(user, null);
});

await test('findUserByNickname — retorna null para nickname inexistente', async () => {
    const user = await findUserByNickname('nick_que_no_existe_jamás_xyzqq');
    assert.strictEqual(user, null);
});

await test('generateUserCode — genera código con formato USR-XXXXXX', async () => {
    const code = await generateUserCode();
    assert.match(code, /^USR-\d{6}$/);
});

await test('findUserById — encuentra usuario existente', async () => {
    const { id, nickname } = await createTestUser('findbyid');
    const user = await findUserById(id);
    assert.ok(user !== null, 'debe encontrar el usuario');
    assert.strictEqual(user.nickname, nickname);
});

await test('findUserByNickname — encuentra usuario existente', async () => {
    const { id, nickname } = await createTestUser('findbynick');
    const user = await findUserByNickname(nickname);
    assert.ok(user !== null, 'debe encontrar el usuario');
    assert.strictEqual(user.id, id);
});

await test('createSession + findUserBySessionToken + removeSession — ciclo completo', async () => {
    const { id } = await createTestUser('session');

    const token = await createSession(id);
    assert.ok(token && token.length > 0, 'debe retornar token no vacío');

    const userFromToken = await findUserBySessionToken(token);
    assert.ok(userFromToken !== null, 'debe encontrar usuario por token');
    assert.strictEqual(userFromToken.id, id);

    await removeSession(token);
    const afterRemove = await findUserBySessionToken(token);
    assert.strictEqual(afterRemove, null, 'token debe haber sido eliminado');
});

// ══ 3. Profiles ══════════════════════════════════════════════════════════════
section('4. Profiles — service');

await test('getOrCreateProfile — crea perfil en primera llamada', async () => {
    const { id, nickname } = await createTestUser('profile1');
    const row = await getOrCreateProfile(id, nickname);
    assert.ok(row !== null, 'debe retornar fila');
    assert.strictEqual(row.user_id, id);
});

await test('getOrCreateProfile — retorna perfil existente en segunda llamada', async () => {
    const { id, nickname } = await createTestUser('profile2');
    const row1 = await getOrCreateProfile(id, nickname);
    const row2 = await getOrCreateProfile(id, nickname);
    assert.strictEqual(row1.user_id, row2.user_id, 'debe ser el mismo perfil');
});

// ── Limpieza ──────────────────────────────────────────────────────────────────
await cleanup();
await pool.end();

// ── Resumen ───────────────────────────────────────────────────────────────────
const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
const ms   = results.reduce((s, r) => s + r.ms, 0);
console.log('\n' + '─'.repeat(56));
console.log(`\x1b[1mResultado integración:\x1b[0m  \x1b[32m${pass} ✓\x1b[0m  ${fail > 0 ? `\x1b[31m${fail} ✗\x1b[0m` : ''}  \x1b[2m(${ms}ms total)\x1b[0m`);
console.log('─'.repeat(56));

process.exitCode = fail > 0 ? 1 : 0;

}

run().catch(err => { console.error(err); process.exit(1); });
