require('dotenv').config();

const WebSocket = require('ws');
const { Pool } = require('pg');

const USERS = Number(process.env.TEST_USERS || 100);
const MESSAGES = Number(process.env.TEST_MESSAGES || 300);
const URLS = (process.env.SERVER_URLS || 'ws://localhost:3000,ws://localhost:3001')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
const RUN_ID = Date.now().toString(36);
const PASSWORD = '123456';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 30000);
const MIN_DELIVERY_PERCENT = Number(process.env.TEST_MIN_DELIVERY_PERCENT || 95);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://chatuser:chatpass@localhost:5432/chatdb';
const EXPECTED_HISTORY = Number(process.env.MAX_HISTORY || 300);

const clients = [];
const perServer = new Map(URLS.map((url) => [url, 0]));
let authOk = 0;
let authErrors = 0;
let broadcasts = 0;
let userListEvents = 0;
let histories = 0;

function sendJson(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
    }
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient(index) {
    return new Promise((resolve, reject) => {
        const url = URLS[index % URLS.length];
        const nickname = `bot_${RUN_ID}_${index}`;
        const ws = new WebSocket(url);
        const client = { index, url, nickname, ws, authenticated: false };
        clients.push(client);
        perServer.set(url, (perServer.get(url) || 0) + 1);

        const timer = setTimeout(() => {
            reject(new Error(`Timeout autenticando ${nickname} en ${url}`));
        }, TIMEOUT_MS);

        ws.on('open', () => {
            sendJson(ws, {
                type: 'register',
                payload: {
                    firstName: 'Bot',
                    lastName: String(index),
                    nickname,
                    password: PASSWORD,
                    passwordConfirm: PASSWORD
                }
            });
        });

        ws.on('message', (raw) => {
            let data;
            try {
                data = JSON.parse(raw.toString());
            } catch {
                return;
            }

            if (data.type === 'auth_success' && !client.authenticated) {
                client.authenticated = true;
                client.user = data.payload.user;
                authOk += 1;
                clearTimeout(timer);
                resolve(client);
            }

            if (data.type === 'auth_error') authErrors += 1;
            if (data.type === 'broadcast') broadcasts += 1;
            if (data.type === 'user_list') userListEvents += 1;
            if (data.type === 'history') {
                histories += 1;
                client.historySize = Array.isArray(data.payload.messages) ? data.payload.messages.length : 0;
            }
        });

        ws.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function countStoredGlobalMessages() {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
        const result = await pool.query('SELECT COUNT(*)::int AS total FROM global_messages');
        return result.rows[0]?.total || 0;
    } finally {
        await pool.end();
    }
}

async function run() {
    console.log('==============================================');
    console.log('Prueba de carga WebSocket distribuida');
    console.log('Usuarios:', USERS);
    console.log('Mensajes globales:', MESSAGES);
    console.log('Servidores:', URLS.join(', '));
    console.log('Historial esperado en PostgreSQL:', Math.min(MESSAGES, EXPECTED_HISTORY));
    console.log('==============================================');

    const startedAt = Date.now();
    const batchSize = 10;
    for (let i = 0; i < USERS; i += batchSize) {
        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, USERS); j += 1) {
            batch.push(createClient(j));
        }
        await Promise.all(batch);
        console.log(`Autenticados: ${Math.min(i + batchSize, USERS)}/${USERS}`);
        await wait(150);
    }

    await wait(1000);

    for (let i = 0; i < MESSAGES; i += 1) {
        const sender = clients[i % clients.length];
        sendJson(sender.ws, {
            type: 'message',
            payload: { text: `Mensaje de prueba ${i + 1}/${MESSAGES} desde ${sender.nickname}` }
        });
        await wait(20);
    }

    await wait(5000);

    const expectedBroadcasts = USERS * MESSAGES;
    const deliveryPercent = (broadcasts / expectedBroadcasts) * 100;
    const storedGlobalMessages = await countStoredGlobalMessages().catch((error) => {
        console.error('No se pudo verificar PostgreSQL:', error.message);
        return -1;
    });
    const expectedStoredMessages = Math.min(MESSAGES, EXPECTED_HISTORY);
    const duration = ((Date.now() - startedAt) / 1000).toFixed(2);

    console.log('==============================================');
    console.log('Resultado');
    console.log('Usuarios autenticados:', authOk);
    console.log('Errores de autenticación:', authErrors);
    console.log('Distribución por servidor:', Object.fromEntries(perServer));
    console.log('Eventos user_list recibidos:', userListEvents);
    console.log('Eventos history recibidos:', histories);
    console.log('Broadcasts esperados:', expectedBroadcasts);
    console.log('Broadcasts recibidos:', broadcasts);
    console.log('Cobertura de entrega:', `${deliveryPercent.toFixed(2)}%`);
    console.log('Mensajes globales almacenados en PostgreSQL:', storedGlobalMessages);
    console.log('Duración:', `${duration}s`);
    console.log('==============================================');

    clients.forEach((client) => client.ws.close());

    if (authOk !== USERS) {
        console.error('No se autenticaron todos los usuarios de prueba.');
        process.exitCode = 1;
    }

    if (deliveryPercent < MIN_DELIVERY_PERCENT) {
        console.error(`La entrega fue menor al ${MIN_DELIVERY_PERCENT}%. Revisen Redis, puertos o saturación local.`);
        process.exitCode = 1;
    }

    if (storedGlobalMessages >= 0 && storedGlobalMessages < expectedStoredMessages) {
        console.error(`El historial almacenado es menor a lo esperado: ${storedGlobalMessages}/${expectedStoredMessages}.`);
        process.exitCode = 1;
    }
}

run().catch((error) => {
    console.error('Error en prueba de carga:', error.message);
    clients.forEach((client) => client.ws.close());
    process.exit(1);
});
