require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('crypto');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { createClient } = require('redis');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const SERVER_ID = process.env.SERVER_ID || `server-${PORT}-${process.pid}`;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 300);
const MAX_NICKNAME_LENGTH = 20;
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH || 300);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10_000);
const RATE_LIMIT_MAX_MESSAGES = Number(process.env.RATE_LIMIT_MAX_MESSAGES || 30);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 30_000);
const MIN_PASSWORD_LENGTH = 6;
const SESSION_DAYS = 30;
const INVITE_SECONDS = 24 * 60 * 60;
const REDIS_CHANNEL = 'chat:events';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://chatuser:chatpass@localhost:5432/chatdb';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL });
const subscriber = redis.duplicate();

const users = new Map(); // ws -> usuario público autenticado en ESTE servidor
const socketsByUserId = new Map(); // userId -> Set<WebSocket> en ESTE servidor

const server = http.createServer(handleHttpRequest);
const wss = new WebSocket.Server({ server });

function handleHttpRequest(req, res) {
    const requestedPath = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^([.][.][/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Acceso denegado');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('Archivo no encontrado');
            return;
        }
        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        res.end(content, 'utf-8');
    });
}

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.mp3': 'audio/mpeg',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml; charset=utf-8',
        '.ico': 'image/x-icon'
    };
    return types[extension] || 'application/octet-stream';
}

function logEvent(event) {
    const time = new Intl.DateTimeFormat('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date());
    console.log(`[${time}] [${SERVER_ID}] ${event}`);
}

function sanitizeText(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>?/gm, '')
        .trim()
        .slice(0, maxLength);
}


const MODERATION_TERMS_SEED_FILE = path.join(__dirname, 'config', 'moderation_terms.seed.json');
const MODERATION_RELOAD_EVENT = 'moderation_terms_updated';

const FALLBACK_FORBIDDEN_TERMS = [
    'puta', 'puto', 'mierda', 'cabron', 'cabrón', 'pendejo', 'pendeja',
    'chingada', 'chingar', 'verga', 'pinche', 'culero', 'idiota',
    'imbecil', 'imbécil', 'estupido', 'estúpido', 'fuck', 'shit', 'bitch'
];

let moderationCache = {
    version: 0,
    loadedAt: null,
    terms: [],
    regexList: []
};

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTermForModeration(term) {
    return String(term || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/0/g, 'o')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/7/g, 't')
        .replace(/@/g, 'a')
        .replace(/\$/g, 's')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function getCharacterPattern(char) {
    const patterns = {
        a: '[aáàäâ@4]',
        b: '[b8]',
        c: '[cçk]',
        e: '[eéèëê3]',
        i: '[iíìïî1!|]',
        l: '[l1!|]',
        o: '[oóòöôõ0]',
        s: '[s5$z]',
        t: '[t7+]',
        u: '[uúùüûv]',
        v: '[vúu]',
        g: '[g9]',
        z: '[z2s]',
        n: '[nñ]'
    };
    return patterns[char] || escapeRegExp(char);
}

function buildLooseWordRegex(term) {
    const normalized = normalizeTermForModeration(term);
    if (!normalized || normalized.length < 3) return null;

    const sep = '[\\s._\\-*~|/\\\\]*';
    const wordPattern = normalized.split('').map(c => getCharacterPattern(c) + '+').join(sep);

    return new RegExp(
        '(^|[^\\p{L}\\p{N}])(' + wordPattern + ')(?=$|[^\\p{L}\\p{N}])',
        'giu'
    );
}
function normalizeTerms(rows) {
    const byKey = new Map();

    for (const row of rows || []) {
        const term = sanitizeText(row.term || row, 120);
        const normalizedTerm = normalizeTermForModeration(row.normalized_term || term);
        if (!term || normalizedTerm.length < 3) continue;

        const key = `${normalizedTerm}:${row.country_code || 'ALL'}`;
        if (!byKey.has(key)) {
            byKey.set(key, {
                term,
                normalizedTerm,
                countryCode: row.country_code || 'ALL',
                severity: row.severity || 'medium',
                category: row.category || 'profanity',
                source: row.source || 'fallback',
                active: row.active !== false
            });
        }
    }

    return [...byKey.values()].sort((a, b) => b.normalizedTerm.length - a.normalizedTerm.length);
}

function fallbackModerationTerms() {
    return normalizeTerms(FALLBACK_FORBIDDEN_TERMS.map((term) => ({
        term,
        country_code: 'ALL',
        severity: 'medium',
        category: 'profanity',
        source: 'fallback'
    })));
}

function compileModerationRegexList(terms) {
    return terms
        .map((item) => ({ term: item.term, regex: buildLooseWordRegex(item.term) }))
        .filter((item) => item.regex);
}

async function loadModerationTerms() {
    try {
        const result = await pool.query(`
            SELECT term, normalized_term, country_code, severity, category, source
            FROM moderation_terms
            WHERE active = TRUE
            ORDER BY LENGTH(normalized_term) DESC, term ASC
        `);

        const terms = normalizeTerms(result.rows);
        const activeTerms = terms.length ? terms : fallbackModerationTerms();
        moderationCache = {
            version: moderationCache.version + 1,
            loadedAt: new Date(),
            terms: activeTerms,
            regexList: compileModerationRegexList(activeTerms)
        };

        logEvent(`Moderación cargada: ${moderationCache.terms.length} términos activos.`);
        return moderationCache;
    } catch (error) {
        const activeTerms = fallbackModerationTerms();
        moderationCache = {
            version: moderationCache.version + 1,
            loadedAt: new Date(),
            terms: activeTerms,
            regexList: compileModerationRegexList(activeTerms)
        };
        console.warn('No se pudo cargar moderation_terms desde PostgreSQL. Usando lista mínima:', error.message);
        return moderationCache;
    }
}

function loadSeedModerationTerms() {
    try {
        if (!fs.existsSync(MODERATION_TERMS_SEED_FILE)) return [];
        const raw = fs.readFileSync(MODERATION_TERMS_SEED_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('No se pudo leer config/moderation_terms.seed.json:', error.message);
        return [];
    }
}

async function seedModerationTermsIfEmpty() {
    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM moderation_terms');
    if ((countResult.rows[0]?.total || 0) > 0) return;

    const seedTerms = normalizeTerms(loadSeedModerationTerms());
    const terms = seedTerms.length ? seedTerms : fallbackModerationTerms();

    for (const item of terms) {
        await pool.query(
            `INSERT INTO moderation_terms
             (term, normalized_term, language, country_code, severity, category, source, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (normalized_term, country_code) DO UPDATE
             SET term = EXCLUDED.term,
                 severity = EXCLUDED.severity,
                 category = EXCLUDED.category,
                 source = EXCLUDED.source,
                 updated_at = NOW()`,
            [item.term, item.normalizedTerm, 'es', item.countryCode, item.severity, item.category, item.source, item.active !== false]
        );
    }

    logEvent(`Moderación sembrada en PostgreSQL: ${terms.length} términos base.`);
}

function censorText(originalText) {
    const original = String(originalText || '');
    let censoredText = original;
    const matchedTerms = [];

    if (!moderationCache || !Array.isArray(moderationCache.regexList)) {
        return { originalText: original, censoredText, matchedTerms };
    }

    for (const item of moderationCache.regexList) {
        if (!item.regex) continue;
        item.regex.lastIndex = 0;
        if (item.regex.test(censoredText)) {
            matchedTerms.push(item.term);
            item.regex.lastIndex = 0;
            censoredText = censoredText.replace(item.regex, (fullMatch, prefix, badWord) => {
                return `${prefix}${'*'.repeat(badWord.length)}`;
            });
        }
    }

    return { originalText: original, censoredText, matchedTerms };
}

function moderateMessageText(originalText) {
    const result = censorText(originalText);
    return {
        textOriginal:  result.originalText,
        textCensored:  result.censoredText,
        matchedTerms:  result.matchedTerms
    };
}

function censorMessageText(originalText) {
    return moderateMessageText(originalText).textCensored;
}

function clientWantsCensorship(ws) {
    return ws.preferences?.censorshipEnabled !== false;
}

function buildReplySnapshot(payload = {}) {
    const reply = payload.replyTo || null;
    if (!reply && !payload.replyToId) return { replyToId: null, replyAuthor: null, replyText: null, replyTo: null };
    const replyToId = sanitizeText(payload.replyToId || reply?.id || '', 80) || null;
    const replyAuthor = sanitizeText(reply?.nickname || reply?.author || reply?.from || '', 80) || null;
    const replyText = sanitizeText(reply?.text || '', MAX_MESSAGE_LENGTH) || null;
    return {
        replyToId,
        replyAuthor,
        replyText,
        replyTo: replyToId || replyText ? { id: replyToId, nickname: replyAuthor || 'Usuario', text: replyText || '' } : null
    };
}

function buildPayloadForClient(payload, ws) {
    const wantsCensored = clientWantsCensorship(ws);
    const text = wantsCensored
        ? (payload.textCensored ?? payload.text ?? '')
        : (payload.textOriginal ?? payload.text ?? '');
    const { textOriginal, textCensored, ...safePayload } = payload;
    return { ...safePayload, text };
}

function sendMessageToClient(ws, type, payload, timestamp) {
    sendJson(ws, { type, payload: buildPayloadForClient(payload, ws), timestamp });
}

function broadcastMessageLocal(type, payload, timestamp, excludeConnectionId = null) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.connectionId !== excludeConnectionId) {
            sendMessageToClient(client, type, payload, timestamp);
        }
    });
}

function sendMessageToLocalUser(userId, type, payload, timestamp, excludeConnectionId = null) {
    getSocketsForUser(userId).forEach((client) => {
        if (client.connectionId !== excludeConnectionId) {
            sendMessageToClient(client, type, payload, timestamp);
        }
    });
}

function normalizeNickname(nickname) {
    return String(nickname || '').trim().toLowerCase();
}

function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, user) {
    if (!user?.passwordSalt || !user?.passwordHash) return false;
    const testHash = scryptSync(password, user.passwordSalt, 64);
    const storedHash = Buffer.from(user.passwordHash, 'hex');
    if (storedHash.length !== testHash.length) return false;
    return timingSafeEqual(storedHash, testHash);
}

function sendJson(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function checkRateLimit(ws) {
    const now = Date.now();
    if (!ws.rateLimit) {
        ws.rateLimit = { windowStart: now, count: 0 };
    }

    if (now - ws.rateLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
        ws.rateLimit.windowStart = now;
        ws.rateLimit.count = 0;
    }

    ws.rateLimit.count += 1;
    return ws.rateLimit.count <= RATE_LIMIT_MAX_MESSAGES;
}

function rejectRateLimited(ws) {
    sendJson(ws, {
        type: 'error',
        payload: { text: 'Estás enviando demasiados mensajes. Espera unos segundos.' },
        timestamp: new Date().toISOString()
    });
}

function broadcastLocal(data, excludeConnectionId = null) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.connectionId !== excludeConnectionId) {
            client.send(JSON.stringify(data));
        }
    });
}

function getSocketsForUser(userId) {
    return socketsByUserId.get(userId) || new Set();
}

function sendToLocalUser(userId, data, excludeConnectionId = null) {
    getSocketsForUser(userId).forEach((client) => {
        if (client.connectionId !== excludeConnectionId) {
            sendJson(client, data);
        }
    });
}

function toPublicUser(row, online = false) {
    if (!row) return null;
    return {
        id: row.id,
        code: row.code,
        firstName: row.first_name ?? row.firstName,
        lastName: row.last_name ?? row.lastName,
        nickname: row.nickname,
        isOnline: online
    };
}

async function initDatabase() {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            nickname TEXT NOT NULL UNIQUE,
            nickname_normalized TEXT NOT NULL UNIQUE,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS global_messages (
            id UUID PRIMARY KEY,
            from_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_nickname TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS private_messages (
            id UUID PRIMARY KEY,
            from_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_nickname TEXT NOT NULL,
            to_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            to_nickname TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS groups (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL,
            created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS group_members (
            group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (group_id, user_id)
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS group_messages (
            id UUID PRIMARY KEY,
            group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            group_name TEXT NOT NULL,
            from_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_nickname TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        );
    `);


    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS text_original TEXT;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS text_censored TEXT;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID NULL;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS reply_author TEXT NULL;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS reply_text TEXT NULL;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS forwarded_from_id UUID NULL;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS deleted_by UUID NULL;`);
    await pool.query(`ALTER TABLE global_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);

    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS text_original TEXT;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS text_censored TEXT;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID NULL;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS reply_author TEXT NULL;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS reply_text TEXT NULL;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS forwarded_from_id UUID NULL;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS deleted_by UUID NULL;`);
    await pool.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);

    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS text_original TEXT;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS text_censored TEXT;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID NULL;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_author TEXT NULL;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_text TEXT NULL;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS forwarded_from_id UUID NULL;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS deleted_by UUID NULL;`);
    await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);

    await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);
    await pool.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';`);
    await pool.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS hidden_for_user BOOLEAN NOT NULL DEFAULT FALSE;`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS message_reactions (
            message_id UUID NOT NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emoji TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (message_id, user_id)
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS moderation_terms (
            id SERIAL PRIMARY KEY,
            term TEXT NOT NULL,
            normalized_term TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT 'es',
            country_code TEXT NOT NULL DEFAULT 'ALL',
            severity TEXT NOT NULL DEFAULT 'medium',
            category TEXT NOT NULL DEFAULT 'profanity',
            source TEXT NOT NULL DEFAULT 'manual',
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (normalized_term, country_code)
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_moderation_preferences (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            censorship_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS moderation_audit (
            id SERIAL PRIMARY KEY,
            message_id UUID NULL,
            user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
            message_kind TEXT NOT NULL,
            matched_terms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`UPDATE global_messages SET text_original = text WHERE text_original IS NULL;`);
    await pool.query(`UPDATE global_messages SET text_censored = text WHERE text_censored IS NULL;`);
    await pool.query(`UPDATE private_messages SET text_original = text WHERE text_original IS NULL;`);
    await pool.query(`UPDATE private_messages SET text_censored = text WHERE text_censored IS NULL;`);
    await pool.query(`UPDATE group_messages SET text_original = text WHERE text_original IS NULL;`);
    await pool.query(`UPDATE group_messages SET text_censored = text WHERE text_censored IS NULL;`);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_global_messages_created_at ON global_messages(created_at DESC);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_private_messages_users ON private_messages(from_id, to_id, created_at DESC);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON group_messages(group_id, created_at DESC);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_moderation_terms_active ON moderation_terms(active, normalized_term);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_moderation_audit_created ON moderation_audit(created_at DESC);');

    await seedModerationTermsIfEmpty();
}

async function generateUserCode() {
    let code;
    let exists = true;
    while (exists) {
        code = `USR-${Math.floor(100000 + Math.random() * 900000)}`;
        const result = await pool.query('SELECT 1 FROM users WHERE code = $1 LIMIT 1', [code]);
        exists = result.rowCount > 0;
    }
    return code;
}

async function findUserById(userId) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
    return result.rows[0] || null;
}

async function findUserByNickname(nickname) {
    const result = await pool.query('SELECT * FROM users WHERE nickname_normalized = $1 LIMIT 1', [normalizeNickname(nickname)]);
    return result.rows[0] || null;
}

async function createSession(userId) {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
    await pool.query(
        'INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES($1, $2, $3, $4)',
        [token, userId, now.toISOString(), expiresAt.toISOString()]
    );
    return token;
}

async function findUserBySessionToken(token) {
    const cleanToken = sanitizeText(token, 200);
    const result = await pool.query(
        `SELECT users.*
         FROM sessions
         INNER JOIN users ON users.id = sessions.user_id
         WHERE sessions.token = $1 AND sessions.expires_at > NOW()
         LIMIT 1`,
        [cleanToken]
    );
    return result.rows[0] || null;
}

async function removeSession(token) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [sanitizeText(token, 200)]);
}

async function getUserModerationPreference(userId) {
    const result = await pool.query(
        `SELECT censorship_enabled
         FROM user_moderation_preferences
         WHERE user_id = $1
         LIMIT 1`,
        [userId]
    );

    if (!result.rows[0]) return true;
    return result.rows[0].censorship_enabled !== false;
}

async function setUserModerationPreference(userId, enabled) {
    await pool.query(
        `INSERT INTO user_moderation_preferences(user_id, censorship_enabled, updated_at)
         VALUES($1,$2,NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET censorship_enabled = EXCLUDED.censorship_enabled, updated_at = NOW()`,
        [userId, enabled !== false]
    );
}

async function saveModerationAudit({ messageId, userId, kind, matchedTerms }) {
    if (!Array.isArray(matchedTerms) || matchedTerms.length === 0) return;

    await pool.query(
        `INSERT INTO moderation_audit(message_id, user_id, message_kind, matched_terms)
         VALUES($1,$2,$3,$4)`,
        [messageId || null, userId || null, kind || 'unknown', matchedTerms]
    );
}

async function notifyModerationTermsUpdated(reason = 'manual') {
    await publishCluster({ event: MODERATION_RELOAD_EVENT, payload: { reason, serverId: SERVER_ID } });
}

async function getOnlineUserIds() {
    const ids = new Set();
    for await (const key of redis.scanIterator({ MATCH: 'presence:user:*', COUNT: 100 })) {
        const onlineServers = await redis.sCard(key);
        if (onlineServers > 0) ids.add(key.replace('presence:user:', ''));
    }
    return Array.from(ids);
}

async function getUserList() {
    const onlineIds = await getOnlineUserIds();
    if (!onlineIds.length) return [];
    const result = await pool.query(
        'SELECT id, code, first_name, last_name, nickname FROM users WHERE id = ANY($1::uuid[]) ORDER BY nickname ASC',
        [onlineIds]
    );
    return result.rows.map((row) => toPublicUser(row, true));
}

async function markUserOnline(userId) {
    const wasOnline = (await redis.sCard(`presence:user:${userId}`)) > 0;
    await redis.sAdd(`presence:user:${userId}`, SERVER_ID);
    return wasOnline;
}

async function markUserOfflineFromThisServer(userId) {
    await redis.sRem(`presence:user:${userId}`, SERVER_ID);
    const remaining = await redis.sCard(`presence:user:${userId}`);
    if (remaining === 0) await redis.del(`presence:user:${userId}`);
    return remaining;
}

async function cleanupServerPresence() {
    for await (const key of redis.scanIterator({ MATCH: 'presence:user:*', COUNT: 100 })) {
        await redis.sRem(key, SERVER_ID);
        const remaining = await redis.sCard(key);
        if (remaining === 0) await redis.del(key);
    }
}

async function publishCluster(event) {
    await redis.publish(REDIS_CHANNEL, JSON.stringify({ ...event, emittedAt: new Date().toISOString() }));
}


async function getReactionSnapshot(messageId) {
    const result = await pool.query(
        `SELECT emoji, ARRAY_AGG(user_id::text ORDER BY created_at ASC) AS users
         FROM message_reactions
         WHERE message_id = $1
         GROUP BY emoji
         ORDER BY emoji`,
        [messageId]
    );
    return result.rows.map((row) => ({ emoji: row.emoji, users: row.users || [] }));
}

function rowToMessage(row, kind, censorshipEnabled = true) {
    const original = row.text_original || row.text || '';
    const censored = row.text_censored || row.text || original;
    const deletedForAll = Boolean(row.deleted_for_all);
    const text = deletedForAll
        ? ''
        : (censorshipEnabled ? censored : original);
    return {
        id: row.id,
        fromId: row.from_id,
        from: row.from_nickname,
        text,
        replyTo: row.reply_to_id || row.reply_text ? {
            id: row.reply_to_id,
            nickname: row.reply_author || 'Usuario',
            text: row.reply_text || ''
        } : null,
        isForwarded: Boolean(row.is_forwarded),
        forwardedFromId: row.forwarded_from_id,
        deletedForAll,
        deletedBy: row.deleted_by,
        timestamp: row.created_at.toISOString(),
        kind
    };
}

async function sendInitialState(ws, publicUser) {
    const censorshipEnabled = clientWantsCensorship(ws);
    const globalHistory = await getGlobalHistory(censorshipEnabled);
    sendJson(ws, {
        type: 'history',
        payload: { messages: globalHistory },
        timestamp: new Date().toISOString()
    });

    sendJson(ws, {
        type: 'group_list',
        payload: { groups: await getGroupsForUser(publicUser.id, censorshipEnabled) },
        timestamp: new Date().toISOString()
    });

    sendJson(ws, {
        type: 'private_conversations',
        payload: { conversations: await getPrivateConversationsForUser(publicUser.id, censorshipEnabled) },
        timestamp: new Date().toISOString()
    });
}

async function getGlobalHistory(censorshipEnabled = true) {
    const result = await pool.query(
        `SELECT *
         FROM global_messages
         ORDER BY created_at DESC
         LIMIT $1`,
        [MAX_HISTORY]
    );

    const rows = result.rows.reverse();
    const messages = [];
    for (const row of rows) {
        const message = rowToMessage(row, 'global', censorshipEnabled);
        message.reactions = await getReactionSnapshot(row.id);
        messages.push(message);
    }
    return messages;
}

async function getGroupsForUser(userId, censorshipEnabled = true) {
    const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.created_by, g.created_at, gm.role AS self_role
         FROM groups g
         INNER JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = $1 AND COALESCE(gm.hidden_for_user, FALSE) = FALSE AND g.deleted_at IS NULL
         ORDER BY g.created_at DESC`,
        [userId]
    );

    const groups = [];
    for (const group of groupsResult.rows) {
        const membersResult = await pool.query(
            `SELECT u.id, u.code, u.first_name, u.last_name, u.nickname, gm.role
             FROM group_members gm
             INNER JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY u.nickname ASC`,
            [group.id]
        );
        const onlineIds = new Set(await getOnlineUserIds());
        const historyResult = await pool.query(
            `SELECT *
             FROM group_messages
             WHERE group_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [group.id, MAX_HISTORY]
        );

        groups.push({
            id: group.id,
            name: group.name,
            createdBy: group.created_by,
            createdAt: group.created_at.toISOString(),
            selfRole: group.self_role,
            members: membersResult.rows.map((row) => ({ ...toPublicUser(row, onlineIds.has(row.id)), role: row.role })),
            history: await Promise.all(historyResult.rows.reverse().map(async (message) => {
                const item = rowToMessage(message, 'group', censorshipEnabled);
                item.groupId = message.group_id;
                item.groupName = message.group_name;
                item.reactions = await getReactionSnapshot(message.id);
                return item;
            }))
        });
    }
    return groups;
}

async function getPrivateConversationsForUser(userId, censorshipEnabled = true) {
    const result = await pool.query(
        `SELECT * FROM private_messages
         WHERE from_id = $1 OR to_id = $1
         ORDER BY created_at ASC`,
        [userId]
    );

    const grouped = new Map();
    for (const message of result.rows) {
        const otherId = message.from_id === userId ? message.to_id : message.from_id;
        if (!grouped.has(otherId)) {
            const otherUser = await findUserById(otherId);
            if (!otherUser) continue;
            grouped.set(otherId, {
                user: toPublicUser(otherUser, (await getOnlineUserIds()).includes(otherId)),
                messages: [],
                updatedAt: message.created_at.toISOString()
            });
        }

        const conversation = grouped.get(otherId);
        const privateMessage = rowToMessage(message, 'private', censorshipEnabled);
        privateMessage.toId = message.to_id;
        privateMessage.to = message.to_nickname;
        privateMessage.direction = message.from_id === userId ? 'out' : 'in';
        privateMessage.reactions = await getReactionSnapshot(message.id);
        conversation.messages.push(privateMessage);
        conversation.updatedAt = message.created_at.toISOString();
    }

    return Array.from(grouped.values())
        .map((conversation) => ({
            ...conversation,
            messages: conversation.messages.slice(-MAX_HISTORY)
        }))
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function broadcastUserListLocal() {
    broadcastLocal({
        type: 'user_list',
        payload: { users: await getUserList() },
        timestamp: new Date().toISOString()
    });
}

async function broadcastGroupListsLocal() {
    for (const [client, user] of users.entries()) {
        sendJson(client, {
            type: 'group_list',
            payload: { groups: await getGroupsForUser(user.id, clientWantsCensorship(client)) },
            timestamp: new Date().toISOString()
        });
    }
}

async function attachAuthenticatedUser(ws, userRow, sessionToken) {
    await detachSocket(ws, false);

    const wasOfflineLocal = !socketsByUserId.has(userRow.id);
    const publicUser = toPublicUser(userRow, true);
    const censorshipEnabled = await getUserModerationPreference(userRow.id);
    ws.preferences = { ...(ws.preferences || {}), censorshipEnabled };
    users.set(ws, publicUser);

    if (!socketsByUserId.has(userRow.id)) socketsByUserId.set(userRow.id, new Set());
    socketsByUserId.get(userRow.id).add(ws);

    const wasOnlineGlobal = await markUserOnline(userRow.id);

    sendJson(ws, {
        type: 'auth_success',
        payload: { sessionToken, user: publicUser, censorshipEnabled },
        timestamp: new Date().toISOString()
    });

    await sendInitialState(ws, publicUser);

    if (wasOfflineLocal) {
        logEvent(`${userRow.nickname} conectado`);
    }

    if (!wasOnlineGlobal) {
        await publishCluster({ event: 'system', payload: { text: `${userRow.nickname} se ha conectado 🟢` } });
    }
    await publishCluster({ event: 'presence_update' });
    await publishCluster({ event: 'group_lists_update' });
}

async function detachSocket(ws, notify = true) {
    const user = users.get(ws);
    if (!user) return;

    users.delete(ws);
    const sockets = socketsByUserId.get(user.id);
    if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
            socketsByUserId.delete(user.id);
            const remainingGlobalConnections = await markUserOfflineFromThisServer(user.id);
            if (notify) {
                if (remainingGlobalConnections === 0) {
                    await publishCluster({ event: 'system', payload: { text: `${user.nickname} se ha desconectado 🔴` } });
                }
                await publishCluster({ event: 'presence_update' });
                await publishCluster({ event: 'group_lists_update' });
                logEvent(`${user.nickname} desconectado`);
            }
        }
    }
}

function validateRegisterPayload(payload) {
    const firstName = sanitizeText(payload.firstName, MAX_NAME_LENGTH);
    const lastName = sanitizeText(payload.lastName, MAX_NAME_LENGTH);
    const nickname = sanitizeText(payload.nickname, MAX_NICKNAME_LENGTH);
    const password = String(payload.password || '');
    const passwordConfirm = payload.passwordConfirm === undefined ? password : String(payload.passwordConfirm || '');

    if (!firstName || !lastName || !nickname) return { valid: false, data: {}, error: 'Nombre, apellido y nickname son obligatorios.' };
    if (password.length < MIN_PASSWORD_LENGTH) return { valid: false, data: {}, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    if (password !== passwordConfirm) return { valid: false, data: {}, error: 'Las contraseñas no coinciden.' };
    return { valid: true, data: { firstName, lastName, nickname, password }, error: '' };
}

async function handleRegister(ws, payload) {
    const validation = validateRegisterPayload(payload);
    if (!validation.valid) {
        sendJson(ws, { type: 'auth_error', payload: { text: validation.error }, timestamp: new Date().toISOString() });
        return;
    }

    const { firstName, lastName, nickname, password } = validation.data;
    const existing = await findUserByNickname(nickname);
    if (existing) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'Ese nickname ya está registrado. Usa otro o inicia sesión.' }, timestamp: new Date().toISOString() });
        return;
    }

    const { salt, hash } = hashPassword(password);
    const now = new Date().toISOString();
    const user = {
        id: randomUUID(),
        code: await generateUserCode(),
        firstName,
        lastName,
        nickname,
        passwordSalt: salt,
        passwordHash: hash,
        createdAt: now,
        updatedAt: now
    };

    await pool.query(
        `INSERT INTO users(id, code, first_name, last_name, nickname, nickname_normalized, password_salt, password_hash, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [user.id, user.code, user.firstName, user.lastName, user.nickname, normalizeNickname(user.nickname), user.passwordSalt, user.passwordHash, user.createdAt, user.updatedAt]
    );

    const token = await createSession(user.id);
    await attachAuthenticatedUser(ws, {
        id: user.id,
        code: user.code,
        first_name: user.firstName,
        last_name: user.lastName,
        nickname: user.nickname,
        password_salt: user.passwordSalt,
        password_hash: user.passwordHash
    }, token);
}

async function handleLogin(ws, payload) {
    const nickname = sanitizeText(payload.nickname, MAX_NICKNAME_LENGTH);
    const password = String(payload.password || '');
    const user = await findUserByNickname(nickname);

    if (!nickname || !password) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'Ingresa nickname y contraseña.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (!user) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'No existe una cuenta registrada con ese nickname.' }, timestamp: new Date().toISOString() });
        return;
    }

    const userForVerify = {
        passwordSalt: user.password_salt,
        passwordHash: user.password_hash
    };
    if (!verifyPassword(password, userForVerify)) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'La contraseña es incorrecta.' }, timestamp: new Date().toISOString() });
        return;
    }

    const token = await createSession(user.id);
    await attachAuthenticatedUser(ws, user, token);
}

async function handleResume(ws, payload) {
    const user = await findUserBySessionToken(payload.sessionToken);
    if (!user) {
        sendJson(ws, { type: 'auth_error', payload: { text: 'La sesión expiró. Inicia sesión nuevamente.' }, timestamp: new Date().toISOString() });
        return;
    }
    await attachAuthenticatedUser(ws, user, sanitizeText(payload.sessionToken, 200));
}

async function handleLogout(ws, payload) {
    await removeSession(payload.sessionToken);
    await detachSocket(ws, true);
    sendJson(ws, { type: 'logout_success', payload: {}, timestamp: new Date().toISOString() });
}

async function handleMessage(ws, payload, timestamp) {
    try {
        const user = users.get(ws);
        const textOriginal = sanitizeText(payload.text || payload.texto, MAX_MESSAGE_LENGTH);
        if (!user?.nickname || !textOriginal) return;

        const moderation = moderateMessageText(textOriginal);
        const textCensored = moderation.textCensored;
        const reply = buildReplySnapshot(payload);
        const isForwarded = Boolean(payload.isForwarded);
        const forwardedFromId = sanitizeText(payload.forwardedFromId || '', 80) || null;

        const message = {
            id: randomUUID(),
            fromId: user.id,
            from: user.nickname,
            text: textCensored,
            textOriginal,
            textCensored,
            replyTo: reply.replyTo,
            isForwarded,
            forwardedFromId,
            deletedForAll: false,
            deletedBy: null,
            timestamp: timestamp || new Date().toISOString()
        };

        await pool.query(
            `INSERT INTO global_messages
             (id, from_id, from_nickname, text, text_original, text_censored, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [message.id, message.fromId, message.from, message.textCensored, textOriginal, textCensored, reply.replyToId, reply.replyAuthor, reply.replyText, isForwarded, forwardedFromId, message.timestamp]
        );

        await pool.query(
            `DELETE FROM global_messages
             WHERE id NOT IN (SELECT id FROM global_messages ORDER BY created_at DESC LIMIT $1)`,
            [MAX_HISTORY]
        );

        await saveModerationAudit({ messageId: message.id, userId: user.id, kind: 'global', matchedTerms: moderation.matchedTerms });

        await publishCluster({ event: 'broadcast', payload: message });
    } catch (error) {
        console.error('Error al procesar mensaje global:', error);
        sendJson(ws, { type: 'error', payload: { text: 'No se pudo enviar el mensaje.' }, timestamp: new Date().toISOString() });
    }
}

async function handlePrivate(ws, payload, timestamp) {
    try {
        const sender = users.get(ws);
        const targetUser = await findUserById(payload.targetId);
        const textOriginal = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);

        if (!sender?.nickname || !payload.targetId || payload.targetId === sender.id || !targetUser || !textOriginal) {
            sendJson(ws, { type: 'private_error', payload: { text: 'Mensaje privado inválido.' }, timestamp: new Date().toISOString() });
            return;
        }

        const moderation = moderateMessageText(textOriginal);
        const textCensored = moderation.textCensored;
        const reply = buildReplySnapshot(payload);
        const isForwarded = Boolean(payload.isForwarded);
        const forwardedFromId = sanitizeText(payload.forwardedFromId || '', 80) || null;

        const message = {
            id: randomUUID(),
            fromId: sender.id,
            from: sender.nickname,
            toId: targetUser.id,
            to: targetUser.nickname,
            text: textCensored,
            textOriginal,
            textCensored,
            replyTo: reply.replyTo,
            isForwarded,
            forwardedFromId,
            deletedForAll: false,
            deletedBy: null,
            timestamp: timestamp || new Date().toISOString()
        };

        await pool.query(
            `INSERT INTO private_messages
             (id, from_id, from_nickname, to_id, to_nickname, text, text_original, text_censored, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [message.id, message.fromId, message.from, message.toId, message.to, message.textCensored, textOriginal, textCensored, reply.replyToId, reply.replyAuthor, reply.replyText, isForwarded, forwardedFromId, message.timestamp]
        );

        await pool.query(
            `DELETE FROM private_messages pm
             WHERE ((pm.from_id = $1 AND pm.to_id = $2) OR (pm.from_id = $2 AND pm.to_id = $1))
             AND pm.id NOT IN (
                SELECT id
                FROM private_messages
                WHERE ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))
                ORDER BY created_at DESC
                LIMIT $3
             )`,
            [message.fromId, message.toId, MAX_HISTORY]
        );

        await saveModerationAudit({ messageId: message.id, userId: sender.id, kind: 'private', matchedTerms: moderation.matchedTerms });

        await publishCluster({
            event: 'private_msg',
            payload: message,
            originServerId: SERVER_ID,
            originConnectionId: ws.connectionId
        });
    } catch (error) {
        console.error('Error al procesar privado:', error);
        sendJson(ws, { type: 'private_error', payload: { text: 'No se pudo enviar el mensaje privado.' }, timestamp: new Date().toISOString() });
    }
}

async function handleDeletePrivateMessage(ws, payload) {
    const requester = users.get(ws);
    const id = sanitizeText(payload.id, 80);

    if (!requester?.id || !id) {
        sendJson(ws, { type: 'private_error', payload: { text: 'Solicitud de eliminación inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    const result = await pool.query('SELECT * FROM private_messages WHERE id = $1 LIMIT 1', [id]);
    const message = result.rows[0];

    if (!message) {
        sendJson(ws, { type: 'private_error', payload: { text: 'Mensaje no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (message.from_id !== requester.id) {
        sendJson(ws, { type: 'private_error', payload: { text: 'Solo puedes eliminar para todos mensajes enviados por ti.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE private_messages
         SET deleted_for_all = TRUE, deleted_by = $2, deleted_at = NOW(), text = ''
         WHERE id = $1`,
        [id, requester.id]
    );

    await publishCluster({
        event: 'private_delete',
        payload: { id, deletedBy: requester.id, fromId: message.from_id, toId: message.to_id },
        originConnectionId: ws.connectionId
    });
}

async function handleDeleteGlobalMessage(ws, payload) {
    const requester = users.get(ws);
    const id = sanitizeText(payload.id, 80);

    if (!requester?.id || !id) {
        sendJson(ws, { type: 'error', payload: { text: 'Solicitud de eliminación inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    const result = await pool.query('SELECT * FROM global_messages WHERE id = $1 LIMIT 1', [id]);
    const message = result.rows[0];

    if (!message) {
        sendJson(ws, { type: 'error', payload: { text: 'Mensaje no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (message.from_id !== requester.id) {
        sendJson(ws, { type: 'error', payload: { text: 'Solo puedes eliminar para todos mensajes enviados por ti.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE global_messages
         SET deleted_for_all = TRUE, deleted_by = $2, deleted_at = NOW(), text = ''
         WHERE id = $1`,
        [id, requester.id]
    );

    await publishCluster({ event: 'global_delete', payload: { id, deletedBy: requester.id }, originConnectionId: ws.connectionId });
}

async function handleDeleteGroupMessage(ws, payload) {
    const requester = users.get(ws);
    const id = sanitizeText(payload.id, 80);
    const groupId = sanitizeText(payload.groupId, 80);

    if (!requester?.id || !id || !groupId) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solicitud de eliminación inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    const result = await pool.query('SELECT * FROM group_messages WHERE id = $1 LIMIT 1', [id]);
    const message = result.rows[0];

    if (!message) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Mensaje no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (message.from_id !== requester.id) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo puedes eliminar para todos mensajes enviados por ti.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE group_messages
         SET deleted_for_all = TRUE, deleted_by = $2, deleted_at = NOW(), text = ''
         WHERE id = $1`,
        [id, requester.id]
    );

    const membersResult = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
    await publishCluster({
        event: 'group_delete',
        payload: { id, groupId, deletedBy: requester.id },
        memberIds: membersResult.rows.map((row) => row.user_id),
        originConnectionId: ws.connectionId
    });
}

async function handleEditMessage(ws, payload) {
    const requester = users.get(ws);
    const id      = sanitizeText(payload.id,   80);
    const newText = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);
    const kind    = payload.kind;

    if (!requester?.id || !id || !newText || !kind) {
        sendJson(ws, { type: 'error', payload: { text: 'Edición inválida.' }, timestamp: new Date().toISOString() });
        return;
    }

    if (kind === 'global') {
        const { rows } = await pool.query('SELECT * FROM global_messages WHERE id = $1 LIMIT 1', [id]);
        const msg = rows[0];
        if (!msg || msg.from_id !== requester.id) {
            sendJson(ws, { type: 'error', payload: { text: 'No puedes editar este mensaje.' }, timestamp: new Date().toISOString() });
            return;
        }
        const moderation = moderateMessageText(newText);
        const censored = moderation.textCensored;
        await pool.query('UPDATE global_messages SET text = $1, text_original = $2, text_censored = $3 WHERE id = $4 AND deleted_for_all = FALSE', [censored, newText, censored, id]);
        await saveModerationAudit({ messageId: id, userId: requester.id, kind: 'global_edit', matchedTerms: moderation.matchedTerms });
        await publishCluster({ event: 'message_edited', payload: { id, textOriginal: newText, textCensored: censored, text: censored, kind: 'global' } });

    } else if (kind === 'private') {
        const { rows } = await pool.query('SELECT * FROM private_messages WHERE id = $1 LIMIT 1', [id]);
        const msg = rows[0];
        if (!msg || msg.from_id !== requester.id) {
            sendJson(ws, { type: 'private_error', payload: { text: 'No puedes editar este mensaje.' }, timestamp: new Date().toISOString() });
            return;
        }
        const moderation = moderateMessageText(newText);
        const censored = moderation.textCensored;
        await pool.query('UPDATE private_messages SET text = $1, text_original = $2, text_censored = $3 WHERE id = $4 AND deleted_for_all = FALSE', [censored, newText, censored, id]);
        await saveModerationAudit({ messageId: id, userId: requester.id, kind: 'private_edit', matchedTerms: moderation.matchedTerms });
        await publishCluster({ event: 'message_edited', payload: { id, textOriginal: newText, textCensored: censored, text: censored, kind: 'private', fromId: msg.from_id, toId: msg.to_id } });

    } else if (kind === 'group') {
        const { rows } = await pool.query('SELECT * FROM group_messages WHERE id = $1 LIMIT 1', [id]);
        const msg = rows[0];
        if (!msg || msg.from_id !== requester.id) {
            sendJson(ws, { type: 'group_error', payload: { text: 'No puedes editar este mensaje.' }, timestamp: new Date().toISOString() });
            return;
        }
        const moderation = moderateMessageText(newText);
        const censored = moderation.textCensored;
        await pool.query('UPDATE group_messages SET text = $1, text_original = $2, text_censored = $3 WHERE id = $4 AND deleted_for_all = FALSE', [censored, newText, censored, id]);
        await saveModerationAudit({ messageId: id, userId: requester.id, kind: 'group_edit', matchedTerms: moderation.matchedTerms });
        const members = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [msg.group_id]);
        await publishCluster({ event: 'message_edited', payload: { id, textOriginal: newText, textCensored: censored, text: censored, kind: 'group' }, memberIds: members.rows.map((r) => r.user_id) });
    }
}

async function handleReactMessage(ws, payload) {
    const user = users.get(ws);
    if (!user?.id) return;

    const messageId = sanitizeText(String(payload.messageId || ''), 80);
    const emoji = String(payload.emoji || '').slice(0, 8);
    const action = payload.action === 'remove' ? 'remove' : 'add';
    const kind = payload.kind;
    const groupId = payload.groupId || null;
    const targetId = payload.targetId || null;

    const allowedEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    if (!messageId || !allowedEmojis.includes(emoji) || !kind) return;

    if (action === 'remove') {
        await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [messageId, user.id]);
    } else {
        await pool.query(
            `INSERT INTO message_reactions(message_id, user_id, emoji, created_at)
             VALUES($1,$2,$3,NOW())
             ON CONFLICT(message_id, user_id)
             DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
            [messageId, user.id, emoji]
        );
    }

    const reactions = await getReactionSnapshot(messageId);
    const reactPayload = { messageId, emoji, userId: user.id, action, kind, reactions };

    if (kind === 'global') {
        await publishCluster({ event: 'message_reaction', payload: reactPayload });
    } else if (kind === 'private') {
        await publishCluster({ event: 'message_reaction', payload: { ...reactPayload, targetIds: [user.id, targetId].filter(Boolean) } });
    } else if (kind === 'group' && groupId) {
        const membersResult = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
        const memberIds = membersResult.rows.map((r) => r.user_id);
        await publishCluster({ event: 'message_reaction', payload: { ...reactPayload, memberIds } });
    }
}

async function handleCreateGroup(ws, payload) {
    const creator = users.get(ws);
    const name = sanitizeText(payload.name, 40);
    const selectedMemberIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];

    if (!creator?.nickname || !name) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Nombre de grupo inválido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const activeIds = new Set(await getOnlineUserIds());
    const memberIds = new Set([creator.id]);
    selectedMemberIds.forEach((memberId) => {
        if (activeIds.has(memberId) && memberId !== creator.id) memberIds.add(memberId);
    });

    if (memberIds.size < 2) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Selecciona al menos un participante activo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const group = {
        id: randomUUID(),
        name,
        createdBy: creator.id,
        createdAt: new Date().toISOString()
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('INSERT INTO groups(id, name, created_by, created_at) VALUES($1,$2,$3,$4)', [group.id, group.name, group.createdBy, group.createdAt]);
        for (const memberId of memberIds) {
            await client.query('INSERT INTO group_members(group_id, user_id, role) VALUES($1,$2,$3) ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role, hidden_for_user = FALSE', [group.id, memberId, memberId === creator.id ? 'owner' : 'member']);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    await publishCluster({ event: 'group_lists_update' });
    logEvent(`${creator.nickname} creó el grupo ${name}`);
}

async function handleAddGroupMembers(ws, payload) {
    const requester = users.get(ws);
    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 LIMIT 1', [payload.groupId]);
    const group = groupResult.rows[0];
    const selectedIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];

    if (!requester?.nickname || !group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Grupo no encontrado.' }, timestamp: new Date().toISOString() });
        return;
    }

    const isMember = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, requester.id]);
    if (isMember.rowCount === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No eres miembro de este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const requesterRole = isMember.rows[0]?.role;
    if (!['owner', 'admin'].includes(requesterRole)) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo administradores pueden agregar miembros.' }, timestamp: new Date().toISOString() });
        return;
    }

    const activeIds = new Set(await getOnlineUserIds());
    let added = 0;
    for (const id of selectedIds) {
        if (activeIds.has(id)) {
            const insert = await pool.query(`INSERT INTO group_members(group_id, user_id, role, hidden_for_user) VALUES($1,$2,'member',FALSE) ON CONFLICT (group_id, user_id) DO UPDATE SET hidden_for_user = FALSE`, [group.id, id]);
            added += insert.rowCount;
        }
    }

    if (added === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No se agregaron nuevos miembros.' }, timestamp: new Date().toISOString() });
        return;
    }

    await publishCluster({ event: 'group_lists_update' });
}


async function getGroupRole(groupId, userId) {
    const result = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    return result.rows[0]?.role || null;
}

async function handlePromoteGroupAdmin(ws, payload) {
    const requester = users.get(ws);
    const groupId = sanitizeText(payload.groupId, 80);
    const targetUserId = sanitizeText(payload.targetUserId, 80);
    if (!requester?.id || !groupId || !targetUserId) return;

    const role = await getGroupRole(groupId, requester.id);
    if (role !== 'owner') {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo el owner puede nombrar administradores.' }, timestamp: new Date().toISOString() });
        return;
    }

    await pool.query(
        `UPDATE group_members SET role = 'admin', hidden_for_user = FALSE
         WHERE group_id = $1 AND user_id = $2 AND role <> 'owner'`,
        [groupId, targetUserId]
    );
    await publishCluster({ event: 'group_lists_update' });
}

async function handleLeaveGroup(ws, payload) {
    const requester = users.get(ws);
    const groupId = sanitizeText(payload.groupId, 80);
    if (!requester?.id || !groupId) return;

    const role = await getGroupRole(groupId, requester.id);
    if (role === 'owner') {
        const otherAdmins = await pool.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id <> $2 AND role IN ('owner','admin') LIMIT 1`,
            [groupId, requester.id]
        );
        if (otherAdmins.rowCount === 0) {
            sendJson(ws, { type: 'group_error', payload: { text: 'Antes de salir, nombra a otro administrador.' }, timestamp: new Date().toISOString() });
            return;
        }
    }

    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, requester.id]);
    sendJson(ws, { type: 'group_deleted', payload: { groupId }, timestamp: new Date().toISOString() });
    await publishCluster({ event: 'group_lists_update' });
}

async function handleHideGroupChat(ws, payload) {
    const requester = users.get(ws);
    const groupId = sanitizeText(payload.groupId, 80);
    if (!requester?.id || !groupId) return;

    await pool.query(
        `UPDATE group_members SET hidden_for_user = TRUE WHERE group_id = $1 AND user_id = $2`,
        [groupId, requester.id]
    );
    sendJson(ws, { type: 'group_deleted', payload: { groupId }, timestamp: new Date().toISOString() });
    await broadcastGroupListsLocal();
}

async function handleDeleteGroupEveryone(ws, payload) {
    const requester = users.get(ws);
    const groupId = sanitizeText(payload.groupId, 80);
    if (!requester?.id || !groupId) return;

    const role = await getGroupRole(groupId, requester.id);
    if (!['owner', 'admin'].includes(role)) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Solo administradores pueden eliminar el grupo para todos.' }, timestamp: new Date().toISOString() });
        return;
    }

    const members = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
    await pool.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [groupId]);
    await publishCluster({ event: 'group_deleted', payload: { groupId }, memberIds: members.rows.map((r) => r.user_id) });
    await publishCluster({ event: 'group_lists_update' });
}

async function handleToggleCensorship(ws, payload) {
    const user = users.get(ws);
    const enabled = payload.enabled !== false;

    ws.preferences = ws.preferences || { censorshipEnabled: true };
    ws.preferences.censorshipEnabled = enabled;

    if (user?.id) {
        await setUserModerationPreference(user.id, enabled);
    }

    sendJson(ws, {
        type: 'censorship_updated',
        payload: { enabled },
        timestamp: new Date().toISOString()
    });

    if (user?.id) {
        await sendInitialState(ws, user);
    }
}

async function handleGenerateInvite(ws, payload) {
    const requester = users.get(ws);
    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 LIMIT 1', [payload.groupId]);
    const group = groupResult.rows[0];

    if (!requester?.nickname || !group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No puedes generar una invitación para este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const isMember = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, requester.id]);
    if (isMember.rowCount === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'No puedes generar una invitación para este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    await redis.setEx(`invite:${token}`, INVITE_SECONDS, group.id);

    sendJson(ws, {
        type: 'invite_link',
        payload: { token, groupId: group.id, groupName: group.name },
        timestamp: new Date().toISOString()
    });
}

async function handleJoinByInvite(ws, payload) {
    const requester = users.get(ws);
    const token = sanitizeText(payload.token, 80);
    const groupId = await redis.get(`invite:${token}`);

    if (!requester?.nickname || !groupId) {
        sendJson(ws, { type: 'group_error', payload: { text: 'El enlace de invitación no es válido o expiró.' }, timestamp: new Date().toISOString() });
        return;
    }

    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 LIMIT 1', [groupId]);
    const group = groupResult.rows[0];
    if (!group) {
        sendJson(ws, { type: 'group_error', payload: { text: 'El grupo ya no existe.' }, timestamp: new Date().toISOString() });
        return;
    }

    const insert = await pool.query(`INSERT INTO group_members(group_id, user_id, role, hidden_for_user) VALUES($1,$2,'member',FALSE) ON CONFLICT (group_id, user_id) DO UPDATE SET hidden_for_user = FALSE`, [groupId, requester.id]);
    if (insert.rowCount === 0) {
        sendJson(ws, { type: 'group_error', payload: { text: 'Ya eres miembro de este grupo.' }, timestamp: new Date().toISOString() });
        return;
    }

    sendJson(ws, {
        type: 'join_success',
        payload: { id: requester.id, nickname: requester.nickname, groupId: group.id, groupName: group.name },
        timestamp: new Date().toISOString()
    });
    await publishCluster({ event: 'group_lists_update' });
}

async function handleGroupMessage(ws, payload, timestamp) {
    try {
        const sender = users.get(ws);
        const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [payload.groupId]);
        const group = groupResult.rows[0];
        const textOriginal = sanitizeText(payload.text, MAX_MESSAGE_LENGTH);

        if (!sender?.nickname || !group || !textOriginal) {
            sendJson(ws, { type: 'group_error', payload: { text: 'Mensaje de grupo inválido.' }, timestamp: new Date().toISOString() });
            return;
        }

        const isMember = await pool.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, sender.id]);
        if (isMember.rowCount === 0) {
            sendJson(ws, { type: 'group_error', payload: { text: 'Mensaje de grupo inválido.' }, timestamp: new Date().toISOString() });
            return;
        }

        const moderation = moderateMessageText(textOriginal);
        const textCensored = moderation.textCensored;
        const reply = buildReplySnapshot(payload);
        const isForwarded = Boolean(payload.isForwarded);
        const forwardedFromId = sanitizeText(payload.forwardedFromId || '', 80) || null;

        const message = {
            id: randomUUID(),
            groupId: group.id,
            groupName: group.name,
            fromId: sender.id,
            from: sender.nickname,
            text: textCensored,
            textOriginal,
            textCensored,
            replyTo: reply.replyTo,
            isForwarded,
            forwardedFromId,
            deletedForAll: false,
            deletedBy: null,
            timestamp: timestamp || new Date().toISOString()
        };

        await pool.query(
            `INSERT INTO group_messages
             (id, group_id, group_name, from_id, from_nickname, text, text_original, text_censored, reply_to_id, reply_author, reply_text, is_forwarded, forwarded_from_id, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [message.id, message.groupId, message.groupName, message.fromId, message.from, message.textCensored, textOriginal, textCensored, reply.replyToId, reply.replyAuthor, reply.replyText, isForwarded, forwardedFromId, message.timestamp]
        );

        await pool.query(
            `DELETE FROM group_messages gm
             WHERE gm.group_id = $1
             AND gm.id NOT IN (
                SELECT id FROM group_messages WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2
             )`,
            [message.groupId, MAX_HISTORY]
        );

        const membersResult = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [group.id]);
        await saveModerationAudit({ messageId: message.id, userId: sender.id, kind: 'group', matchedTerms: moderation.matchedTerms });
        await publishCluster({ event: 'group_msg', payload: message, memberIds: membersResult.rows.map((row) => row.user_id) });
        await publishCluster({ event: 'group_lists_update' });
    } catch (error) {
        console.error('Error al procesar mensaje de grupo:', error);
        sendJson(ws, { type: 'group_error', payload: { text: 'No se pudo enviar el mensaje de grupo.' }, timestamp: new Date().toISOString() });
    }
}

async function handleTyping(ws, payload) {
    const user = users.get(ws);
    if (!user?.nickname) return;

    const chatType = ['global', 'private', 'group'].includes(payload.chatType) ? payload.chatType : 'global';
    const targetId = sanitizeText(payload.targetId || '', 80);
    const typingPayload = {
        fromId: user.id,
        nickname: user.nickname,
        isTyping: Boolean(payload.isTyping),
        chatType,
        targetId: chatType === 'global' ? 'global' : targetId
    };

    await publishCluster({
        event: 'typing_status',
        payload: typingPayload,
        originUserId: user.id,
        originConnectionId: ws.connectionId
    });
}

async function handleClusterEvent(rawMessage) {
    let data;
    try {
        data = JSON.parse(rawMessage);
    } catch {
        return;
    }

    const timestamp = data.payload?.timestamp || data.emittedAt || new Date().toISOString();

    switch (data.event) {
        case 'broadcast':
            broadcastMessageLocal('broadcast', data.payload, timestamp);
            break;
        case 'private_msg':
            sendMessageToLocalUser(data.payload.toId, 'private_msg', data.payload, timestamp);
            sendMessageToLocalUser(data.payload.fromId, 'private_msg', data.payload, timestamp);
            break;
        case 'private_delete':
            sendToLocalUser(data.payload.toId, { type: 'private_delete', payload: { id: data.payload.id, deletedBy: data.payload.deletedBy }, timestamp });
            sendToLocalUser(data.payload.fromId, { type: 'private_delete', payload: { id: data.payload.id, deletedBy: data.payload.deletedBy }, timestamp });
            break;
        case 'global_delete':
            broadcastLocal({ type: 'global_delete', payload: { id: data.payload.id, deletedBy: data.payload.deletedBy }, timestamp });
            break;
        case 'group_delete':
            (data.memberIds || []).forEach((memberId) => {
                sendToLocalUser(memberId, { type: 'group_delete', payload: { id: data.payload.id, groupId: data.payload.groupId, deletedBy: data.payload.deletedBy }, timestamp });
            });
            break;
        case 'group_deleted':
            (data.memberIds || []).forEach((memberId) => {
                sendToLocalUser(memberId, { type: 'group_deleted', payload: data.payload, timestamp });
            });
            break;
        case 'message_edited':
            if (data.payload.kind === 'global') {
                broadcastMessageLocal('message_edited', data.payload, timestamp);
            } else if (data.payload.kind === 'private') {
                sendMessageToLocalUser(data.payload.fromId, 'message_edited', data.payload, timestamp);
                sendMessageToLocalUser(data.payload.toId, 'message_edited', data.payload, timestamp);
            } else if (data.payload.kind === 'group') {
                (data.memberIds || []).forEach((memberId) => {
                    sendMessageToLocalUser(memberId, 'message_edited', data.payload, timestamp);
                });
            }
            break;
        case 'message_reaction':
            if (data.payload.kind === 'global') {
                broadcastLocal({ type: 'message_reaction', payload: data.payload, timestamp });
            } else if (data.payload.kind === 'private') {
                (data.payload.targetIds || []).forEach((uid) => {
                    sendToLocalUser(uid, { type: 'message_reaction', payload: data.payload, timestamp });
                });
            } else if (data.payload.kind === 'group') {
                (data.payload.memberIds || []).forEach((uid) => {
                    sendToLocalUser(uid, { type: 'message_reaction', payload: data.payload, timestamp });
                });
            }
            break;
        case 'group_msg':
            (data.memberIds || []).forEach((memberId) => {
                sendMessageToLocalUser(memberId, 'group_msg', data.payload, timestamp);
            });
            break;
        case 'typing_status':
            await deliverTypingStatus(data.payload, data.originConnectionId);
            break;
        case 'presence_update':
            await broadcastUserListLocal();
            break;
        case 'group_lists_update':
            await broadcastGroupListsLocal();
            break;
        case 'moderation_terms_updated':
            await loadModerationTerms();
            break;
        case 'system':
            broadcastLocal({ type: 'system', payload: data.payload, timestamp: data.emittedAt });
            break;
        default:
            break;
    }
}

async function deliverTypingStatus(payload, originConnectionId = null) {
    const message = { type: 'typing_status', payload, timestamp: new Date().toISOString() };

    if (payload.chatType === 'global') {
        broadcastLocal(message, originConnectionId);
        return;
    }

    if (payload.chatType === 'private') {
        sendToLocalUser(payload.targetId, message);
        return;
    }

    if (payload.chatType === 'group') {
        const members = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [payload.targetId]);
        members.rows
            .map((row) => row.user_id)
            .filter((memberId) => memberId !== payload.fromId)
            .forEach((memberId) => sendToLocalUser(memberId, message));
    }
}

async function handleSocketMessage(ws, rawMessage) {
    let data;
    try {
        data = JSON.parse(rawMessage.toString());
    } catch {
        sendJson(ws, { type: 'error', payload: { text: 'El mensaje debe ser JSON válido.' }, timestamp: new Date().toISOString() });
        return;
    }

    const { type, payload = {}, timestamp } = data;

    try {
        switch (type) {
            case 'register': await handleRegister(ws, payload); break;
            case 'login': await handleLogin(ws, payload); break;
            case 'resume': await handleResume(ws, payload); break;
            case 'logout': await handleLogout(ws, payload); break;
            case 'message':
                if (!checkRateLimit(ws)) return rejectRateLimited(ws);
                await handleMessage(ws, payload, timestamp);
                break;
            case 'private':
                if (!checkRateLimit(ws)) return rejectRateLimited(ws);
                await handlePrivate(ws, payload, timestamp);
                break;
            case 'delete_private_message':
                await handleDeletePrivateMessage(ws, payload);
                break;
            case 'delete_global_message':
                await handleDeleteGlobalMessage(ws, payload);
                break;
            case 'delete_group_message':
                await handleDeleteGroupMessage(ws, payload);
                break;
            case 'edit_message':
                await handleEditMessage(ws, payload);
                break;
            case 'react_message':
                await handleReactMessage(ws, payload);
                break;
            case 'typing': await handleTyping(ws, payload); break;
            case 'create_group': await handleCreateGroup(ws, payload); break;
            case 'group_message':
                if (!checkRateLimit(ws)) return rejectRateLimited(ws);
                await handleGroupMessage(ws, payload, timestamp);
                break;
            case 'add_group_members': await handleAddGroupMembers(ws, payload); break;
            case 'join_by_invite': await handleJoinByInvite(ws, payload); break;
            case 'generate_invite': await handleGenerateInvite(ws, payload); break;
            case 'promote_group_admin': await handlePromoteGroupAdmin(ws, payload); break;
            case 'leave_group': await handleLeaveGroup(ws, payload); break;
            case 'hide_group_chat': await handleHideGroupChat(ws, payload); break;
            case 'delete_group_everyone': await handleDeleteGroupEveryone(ws, payload); break;
            case 'toggle_censorship': await handleToggleCensorship(ws, payload); break;
            default:
                sendJson(ws, { type: 'error', payload: { text: 'Tipo de mensaje no reconocido.' }, timestamp: new Date().toISOString() });
        }
    } catch (error) {
        console.error(error);
        sendJson(ws, { type: 'error', payload: { text: 'Error interno del servidor.' }, timestamp: new Date().toISOString() });
    }
}

wss.on('connection', (ws) => {
    ws.connectionId = randomUUID();
    ws.isAlive = true;
    ws.rateLimit = { windowStart: Date.now(), count: 0 };
    ws.preferences = { censorshipEnabled: true };

    logEvent('Cliente WebSocket conectado');
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (message) => handleSocketMessage(ws, message));
    ws.on('close', () => detachSocket(ws, true));
    ws.on('error', () => detachSocket(ws, true));
});

const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_INTERVAL_MS);

heartbeatTimer.unref();

async function start() {
    redis.on('error', (error) => console.error('Redis error:', error));
    subscriber.on('error', (error) => console.error('Redis subscriber error:', error));

    await pool.query('SELECT 1');
    await initDatabase();
    await loadModerationTerms();
    await redis.connect();
    await subscriber.connect();
    await cleanupServerPresence();
    await subscriber.subscribe(REDIS_CHANNEL, handleClusterEvent);

    server.listen(PORT, HOST, () => {
        logEvent(`Servidor WebSocket listo en http://${HOST}:${PORT}`);
        logEvent(`Redis: ${REDIS_URL}`);
        logEvent(`PostgreSQL: ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
        logEvent(`Historial máximo por conversación: ${MAX_HISTORY}`);
    });
}

async function shutdown() {
    logEvent('Cerrando servidor...');
    clearInterval(heartbeatTimer);
    server.close();
    for (const userId of socketsByUserId.keys()) {
        await markUserOfflineFromThisServer(userId);
    }
    await publishCluster({ event: 'presence_update' });
    await subscriber.quit().catch(() => {});
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((error) => {
    console.error('No se pudo iniciar el servidor distribuido:', error);
    process.exit(1);
});
