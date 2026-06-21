'use strict';
/**
 * PRUEBAS E2E (WebSocket end-to-end)
 * Arranca el servidor en el puerto 9998, ejecuta los tests y lo detiene.
 * Requiere PostgreSQL y Redis activos.
 */

require('dotenv').config();
const assert  = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { Pool }  = require('pg');

// ── Configuración ─────────────────────────────────────────────────────────────
const TEST_PORT   = 9998;
const WS_URL      = `ws://localhost:${TEST_PORT}`;
const PREFIX      = `e2e_${Date.now().toString(36)}_`;
const PASSWORD    = 'Pass1234!';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://chatuser:chatpass@localhost:5432/chatdb';
const TIMEOUT_MSG  = 6000; // ms por mensaje WS

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

// ── Helpers WS ────────────────────────────────────────────────────────────────
function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
}

function waitFor(ws, type, timeout = TIMEOUT_MSG) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout esperando '${type}'`)), timeout);
        const handler = (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === type) {
                    ws.off('message', handler);
                    clearTimeout(timer);
                    resolve(msg);
                }
            } catch { /* ignore malformed */ }
        };
        ws.on('message', handler);
    });
}

function waitForGroupContaining(ws, groupName, timeout = TIMEOUT_MSG) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout esperando group_list con '${groupName}'`)), timeout);
        const handler = (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'group_list' && Array.isArray(msg.payload?.groups)) {
                    const found = msg.payload.groups.find(g => g.name === groupName);
                    if (found) { ws.off('message', handler); clearTimeout(timer); resolve(found); }
                }
            } catch { /* ignore */ }
        };
        ws.on('message', handler);
    });
}

function send(ws, type, payload = {}) {
    ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
}

async function registerAndAuth(nickname) {
    const ws = await connect();
    const authPromise = waitFor(ws, 'auth_success');
    send(ws, 'register', { firstName: 'Test', lastName: 'User', nickname, password: PASSWORD, passwordConfirm: PASSWORD });
    const auth = await authPromise;
    return { ws, auth };
}

// ── Servidor de pruebas ───────────────────────────────────────────────────────
let serverProcess = null;

async function startServer() {
    return new Promise((resolve, reject) => {
        serverProcess = spawn('node', ['server.js'], {
            cwd: process.cwd(),
            env: { ...process.env, PORT: String(TEST_PORT), SERVER_ID: 'test-e2e', NODE_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const timer = setTimeout(() => reject(new Error('El servidor no arrancó en 20s')), 20000);

        serverProcess.stdout.on('data', (data) => {
            const text = data.toString();
            if (text.includes('WebSocket listo')) {
                clearTimeout(timer);
                setTimeout(resolve, 300); // pequeña espera para que Redis quede listo
            }
        });
        serverProcess.stderr.on('data', (data) => {
            const t = data.toString();
            if (!t.includes('ExperimentalWarning')) process.stderr.write('\x1b[2m[server] ' + t + '\x1b[0m');
        });
        serverProcess.on('error', (err) => { clearTimeout(timer); reject(err); });
        serverProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) console.warn(`[server] salió con código ${code}`);
        });
    });
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
        serverProcess = null;
    }
}

async function cleanupTestUsers() {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
        await pool.query(`DELETE FROM users WHERE nickname LIKE $1`, [PREFIX + '%']);
    } finally {
        await pool.end();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
async function run() {

// ── Arrancar servidor ─────────────────────────────────────────────────────────
process.stdout.write('\n\x1b[2mArrancando servidor de test en puerto ' + TEST_PORT + '...\x1b[0m\n');
try {
    await startServer();
    process.stdout.write('\x1b[2mServidor listo.\x1b[0m\n');
} catch (err) {
    console.error('\x1b[31mNo se pudo iniciar el servidor E2E:\x1b[0m', err.message);
    process.exitCode = 1;
    return;
}

// ════════════════════════════════════════════════════════════════════════════
section('1. Conexión y autenticación');

await test('Acepta conexiones WebSocket', async () => {
    const ws = await connect();
    ws.close();
});

await test('register → auth_success con usuario y token', async () => {
    const nick = PREFIX + 'reg1';
    const { ws, auth } = await registerAndAuth(nick);
    assert.ok(auth.payload?.sessionToken, 'debe tener sessionToken');
    assert.ok(auth.payload?.user?.id, 'debe tener user.id');
    assert.strictEqual(auth.payload.user.nickname, nick);
    ws.close();
});

await test('register — nickname duplicado → auth_error', async () => {
    const nick = PREFIX + 'dup';
    const { ws: ws1 } = await registerAndAuth(nick);
    const ws2 = await connect();
    const errPromise = waitFor(ws2, 'auth_error');
    send(ws2, 'register', { firstName: 'T', lastName: 'U', nickname: nick, password: PASSWORD, passwordConfirm: PASSWORD });
    const err = await errPromise;
    assert.ok(err.payload?.text?.includes('registrado'), `texto: ${err.payload?.text}`);
    ws1.close(); ws2.close();
});

await test('login — credenciales correctas → auth_success', async () => {
    const nick = PREFIX + 'login1';
    const { ws: ws1 } = await registerAndAuth(nick); ws1.close();

    const ws2 = await connect();
    const authPromise = waitFor(ws2, 'auth_success');
    send(ws2, 'login', { nickname: nick, password: PASSWORD });
    const auth = await authPromise;
    assert.ok(auth.payload?.sessionToken);
    ws2.close();
});

await test('login — contraseña incorrecta → auth_error', async () => {
    const nick = PREFIX + 'login2';
    const { ws: ws1 } = await registerAndAuth(nick); ws1.close();

    const ws2 = await connect();
    const errPromise = waitFor(ws2, 'auth_error');
    send(ws2, 'login', { nickname: nick, password: 'wrongpass' });
    const err = await errPromise;
    assert.ok(err.payload?.text?.toLowerCase().includes('contraseña'));
    ws2.close();
});

await test('login — usuario inexistente → auth_error', async () => {
    const ws = await connect();
    const errPromise = waitFor(ws, 'auth_error');
    send(ws, 'login', { nickname: PREFIX + 'noexiste', password: PASSWORD });
    const err = await errPromise;
    assert.ok(err.payload?.text);
    ws.close();
});

await test('resume — token válido → auth_success', async () => {
    const nick = PREFIX + 'resume1';
    const { ws: ws1, auth } = await registerAndAuth(nick);
    const token = auth.payload.sessionToken;
    ws1.close();

    const ws2 = await connect();
    const authPromise = waitFor(ws2, 'auth_success');
    send(ws2, 'resume', { sessionToken: token });
    const resumed = await authPromise;
    assert.ok(resumed.payload?.user?.nickname === nick);
    ws2.close();
});

await test('resume — token inválido → auth_error', async () => {
    const ws = await connect();
    const errPromise = waitFor(ws, 'auth_error');
    send(ws, 'resume', { sessionToken: 'tokeninvalido123' });
    const err = await errPromise;
    assert.ok(err.payload?.text?.includes('expiró') || err.payload?.text?.includes('sesi'));
    ws.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('2. Mensajes globales');

await test('message → broadcast llega a todos los clientes conectados', async () => {
    const nick1 = PREFIX + 'gmsg1';
    const nick2 = PREFIX + 'gmsg2';
    const { ws: ws1 } = await registerAndAuth(nick1);
    const { ws: ws2 } = await registerAndAuth(nick2);

    const broadcastPromise = waitFor(ws2, 'broadcast');
    send(ws1, 'message', { text: 'Hola desde el test' });
    const broadcast = await broadcastPromise;

    assert.strictEqual(broadcast.payload.from, nick1);
    assert.ok(broadcast.payload.text?.length > 0);
    ws1.close(); ws2.close();
});

await test('delete_global_message → emite global_delete', async () => {
    const nick = PREFIX + 'del1';
    const { ws, auth } = await registerAndAuth(nick);

    const broadcastPromise = waitFor(ws, 'broadcast');
    send(ws, 'message', { text: 'Mensaje a borrar' });
    const msg = await broadcastPromise;
    const msgId = msg.payload.id;

    const deletePromise = waitFor(ws, 'global_delete');
    send(ws, 'delete_global_message', { id: msgId });
    const del = await deletePromise;
    assert.strictEqual(del.payload.id, msgId);
    ws.close();
});

await test('edit_message — global → emite message_edited', async () => {
    const nick = PREFIX + 'edit1';
    const { ws } = await registerAndAuth(nick);

    const broadcastPromise = waitFor(ws, 'broadcast');
    send(ws, 'message', { text: 'Mensaje original' });
    const msg = await broadcastPromise;

    const editPromise = waitFor(ws, 'message_edited');
    send(ws, 'edit_message', { id: msg.payload.id, text: 'Mensaje editado', kind: 'global' });
    const edited = await editPromise;
    assert.strictEqual(edited.payload.id, msg.payload.id);
    ws.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('3. Mensajes privados');

await test('private → remitente y destinatario reciben private_msg', async () => {
    const nick1 = PREFIX + 'priv1';
    const nick2 = PREFIX + 'priv2';
    const { ws: ws1, auth: auth1 } = await registerAndAuth(nick1);
    const { ws: ws2, auth: auth2 } = await registerAndAuth(nick2);

    const recv1 = waitFor(ws1, 'private_msg');
    const recv2 = waitFor(ws2, 'private_msg');
    send(ws1, 'private', { targetId: auth2.payload.user.id, text: 'Hola en privado' });

    const [msg1, msg2] = await Promise.all([recv1, recv2]);
    assert.strictEqual(msg1.payload.from, nick1);
    assert.strictEqual(msg2.payload.from, nick1);
    ws1.close(); ws2.close();
});

await test('delete_private_message → ambos reciben private_delete', async () => {
    const nick1 = PREFIX + 'pdel1';
    const nick2 = PREFIX + 'pdel2';
    const { ws: ws1, auth: auth1 } = await registerAndAuth(nick1);
    const { ws: ws2, auth: auth2 } = await registerAndAuth(nick2);

    const recv = waitFor(ws1, 'private_msg');
    send(ws1, 'private', { targetId: auth2.payload.user.id, text: 'msg a borrar' });
    const msg = await recv;

    const del1 = waitFor(ws1, 'private_delete');
    const del2 = waitFor(ws2, 'private_delete');
    send(ws1, 'delete_private_message', { id: msg.payload.id });
    const [d1, d2] = await Promise.all([del1, del2]);
    assert.strictEqual(d1.payload.id, msg.payload.id);
    assert.strictEqual(d2.payload.id, msg.payload.id);
    ws1.close(); ws2.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('4. Reacciones');

await test('react_message — add → emite message_reaction', async () => {
    const nick = PREFIX + 'react1';
    const { ws } = await registerAndAuth(nick);

    const broadcastPromise = waitFor(ws, 'broadcast');
    send(ws, 'message', { text: 'Mensaje para reaccionar' });
    const msg = await broadcastPromise;

    const reactPromise = waitFor(ws, 'message_reaction');
    send(ws, 'react_message', { messageId: msg.payload.id, emoji: '👍', action: 'add', kind: 'global' });
    const reaction = await reactPromise;
    assert.strictEqual(reaction.payload.messageId, msg.payload.id);
    assert.strictEqual(reaction.payload.emoji, '👍');
    assert.strictEqual(reaction.payload.action, 'add');
    ws.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('5. Grupos');

await test('create_group → miembros reciben group_list actualizado', async () => {
    const nick1 = PREFIX + 'grp1';
    const nick2 = PREFIX + 'grp2';
    const { ws: ws1, auth: auth1 } = await registerAndAuth(nick1);
    const { ws: ws2, auth: auth2 } = await registerAndAuth(nick2);

    const glPromise = waitForGroupContaining(ws1, 'Test Group E2E');
    send(ws1, 'create_group', { name: 'Test Group E2E', memberIds: [auth2.payload.user.id] });
    const group = await glPromise;
    assert.ok(group, 'debe incluir el grupo creado');
    assert.strictEqual(group.name, 'Test Group E2E');
    ws1.close(); ws2.close();
});

await test('group_message → miembros reciben group_msg', async () => {
    const nick1 = PREFIX + 'gm1';
    const nick2 = PREFIX + 'gm2';
    const { ws: ws1, auth: auth1 } = await registerAndAuth(nick1);
    const { ws: ws2, auth: auth2 } = await registerAndAuth(nick2);

    const groupPromise = waitForGroupContaining(ws1, 'Chat Grupo Test');
    send(ws1, 'create_group', { name: 'Chat Grupo Test', memberIds: [auth2.payload.user.id] });
    const group = await groupPromise;
    assert.ok(group, 'debe encontrar el grupo creado');

    const recv1 = waitFor(ws1, 'group_msg');
    const recv2 = waitFor(ws2, 'group_msg');
    send(ws1, 'group_message', { groupId: group.id, text: 'Hola al grupo' });
    const [m1, m2] = await Promise.all([recv1, recv2]);
    assert.strictEqual(m1.payload.from, nick1);
    assert.strictEqual(m2.payload.from, nick1);
    ws1.close(); ws2.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('6. Censura y moderación');

await test('message — texto con palabras malas → broadcast con texto censurado', async () => {
    const nick = PREFIX + 'cens1';
    const { ws } = await registerAndAuth(nick);

    const broadcastPromise = waitFor(ws, 'broadcast');
    send(ws, 'message', { text: 'Que puta vida' });
    const bc = await broadcastPromise;
    assert.ok(bc.payload.text.includes('*'), `texto esperado censurado: "${bc.payload.text}"`);
    ws.close();
});

await test('toggle_censorship → emite censorship_updated', async () => {
    const nick = PREFIX + 'cens2';
    const { ws } = await registerAndAuth(nick);

    const updPromise = waitFor(ws, 'censorship_updated');
    send(ws, 'toggle_censorship', { enabled: false });
    const upd = await updPromise;
    assert.strictEqual(upd.payload.enabled, false);
    ws.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('7. Perfiles');

await test('get_my_profile → emite my_profile al conectar y por petición', async () => {
    const nick = PREFIX + 'prof1';
    const { ws, auth } = await registerAndAuth(nick);
    // auth_success ya emite my_profile, obtener uno nuevo por request
    const profPromise = waitFor(ws, 'my_profile');
    send(ws, 'get_my_profile');
    const prof = await profPromise;
    assert.strictEqual(prof.payload.userId, auth.payload.user.id);
    ws.close();
});

await test('update_profile → emite my_profile y profile_updated', async () => {
    const nick = PREFIX + 'prof2';
    const { ws } = await registerAndAuth(nick);

    const myProfPromise    = waitFor(ws, 'my_profile');
    const profUpdPromise   = waitFor(ws, 'profile_updated');
    send(ws, 'update_profile', { displayName: 'Nuevo Nombre', bio: 'Bio de prueba', bannerColor: '#123456' });
    const [myProf, updated] = await Promise.all([myProfPromise, profUpdPromise]);
    assert.strictEqual(myProf.payload.displayName, 'Nuevo Nombre');
    assert.strictEqual(updated.payload.bio, 'Bio de prueba');
    ws.close();
});

await test('update_presence_status → emite presence_updated', async () => {
    const nick = PREFIX + 'pres1';
    const { ws } = await registerAndAuth(nick);

    const presPromise = waitFor(ws, 'presence_updated');
    send(ws, 'update_presence_status', { presenceStatus: 'away' });
    const pres = await presPromise;
    assert.strictEqual(pres.payload.presenceStatus, 'away');
    ws.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('8. Rate limiting');

await test('Enviar 35 mensajes rápido → bloqueo por rate limit', async () => {
    const nick = PREFIX + 'rl1';
    const { ws } = await registerAndAuth(nick);
    let errors = 0;

    const errorPromise = new Promise((resolve) => {
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'error' && msg.payload?.text?.includes('demasiados')) {
                errors++;
                if (errors >= 1) resolve();
            }
        });
        setTimeout(resolve, 4000); // fallback
    });

    for (let i = 0; i < 35; i++) {
        send(ws, 'message', { text: `msg ${i}` });
    }

    await errorPromise;
    assert.ok(errors >= 1, `esperaba ≥1 error de rate-limit, recibí ${errors}`);
    ws.close();
});

// ════════════════════════════════════════════════════════════════════════════
section('9. Logout');

await test('logout → sesión invalidada, posterior resume falla', async () => {
    const nick = PREFIX + 'logout1';
    const { ws, auth } = await registerAndAuth(nick);
    const token = auth.payload.sessionToken;

    const logoutPromise = waitFor(ws, 'logout_success');
    send(ws, 'logout', { sessionToken: token });
    await logoutPromise;
    ws.close();

    // intentar resume con el mismo token
    const ws2 = await connect();
    const errPromise = waitFor(ws2, 'auth_error');
    send(ws2, 'resume', { sessionToken: token });
    const err = await errPromise;
    assert.ok(err.payload?.text, 'debe retornar error');
    ws2.close();
});

// ── Limpiar ────────────────────────────────────────────────────────────────
stopServer();
await cleanupTestUsers();

// ── Resumen ────────────────────────────────────────────────────────────────
const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
const ms   = results.reduce((s, r) => s + r.ms, 0);
console.log('\n' + '─'.repeat(56));
console.log(`\x1b[1mResultado E2E:\x1b[0m  \x1b[32m${pass} ✓\x1b[0m  ${fail > 0 ? `\x1b[31m${fail} ✗\x1b[0m` : ''}  \x1b[2m(${ms}ms total)\x1b[0m`);
console.log('─'.repeat(56));

process.exitCode = fail > 0 ? 1 : 0;

}

run().catch(err => {
    stopServer();
    console.error('\x1b[31mError fatal E2E:\x1b[0m', err.message);
    process.exit(1);
});
