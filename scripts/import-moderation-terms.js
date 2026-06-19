require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('redis');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://chatuser:chatpass@localhost:5432/chatdb';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_CHANNEL = 'chat:events';
const SEED_FILE = path.join(__dirname, '..', 'config', 'moderation_terms.seed.json');

const HOMOGLYPH_MAP = new Map([
    ['0', 'o'], ['1', 'i'], ['3', 'e'], ['4', 'a'], ['5', 's'], ['7', 't'],
    ['@', 'a'], ['$', 's'], ['!', 'i'], ['|', 'i']
]);

function normalizeCharForModeration(char) {
    const plain = String(char || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const mapped = HOMOGLYPH_MAP.get(plain) || plain;
    if (mapped === 'ñ') return 'n';
    return mapped;
}

function normalizeForModeration(text) {
    const chars = [];
    for (const char of String(text || '')) {
        const normalized = normalizeCharForModeration(char);
        if (/^[a-z0-9]$/.test(normalized)) chars.push(normalized);
    }
    return chars.join('');
}

function loadSeedTerms() {
    const raw = fs.readFileSync(SEED_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('El archivo config/moderation_terms.seed.json debe ser un arreglo JSON.');
    return parsed;
}

async function ensureTables(pool) {
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
}

async function importTerms() {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const redis = createClient({ url: REDIS_URL });

    let insertedOrUpdated = 0;
    try {
        await ensureTables(pool);
        const terms = loadSeedTerms();

        for (const item of terms) {
            const term = String(item.term || '').trim();
            const normalizedTerm = normalizeForModeration(item.normalized_term || term);
            if (!term || normalizedTerm.length < 3) continue;

            await pool.query(
                `INSERT INTO moderation_terms
                 (term, normalized_term, language, country_code, severity, category, source, active)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (normalized_term, country_code)
                 DO UPDATE SET
                    term = EXCLUDED.term,
                    language = EXCLUDED.language,
                    severity = EXCLUDED.severity,
                    category = EXCLUDED.category,
                    source = EXCLUDED.source,
                    active = EXCLUDED.active,
                    updated_at = NOW()`,
                [
                    term,
                    normalizedTerm,
                    item.language || 'es',
                    item.country_code || 'ALL',
                    item.severity || 'medium',
                    item.category || 'profanity',
                    item.source || 'seed',
                    item.active !== false
                ]
            );
            insertedOrUpdated += 1;
        }

        try {
            await redis.connect();
            await redis.publish(REDIS_CHANNEL, JSON.stringify({
                event: 'moderation_terms_updated',
                payload: { reason: 'import-script', total: insertedOrUpdated },
                serverId: 'import-script',
                emittedAt: new Date().toISOString()
            }));
            await redis.quit();
        } catch (error) {
            console.warn('No se pudo avisar por Redis. Los servidores recargarán al reiniciar:', error.message);
        }

        console.log(`Catálogo de moderación importado: ${insertedOrUpdated} términos procesados.`);
    } finally {
        await pool.end();
    }
}

importTerms().catch((error) => {
    console.error('Error al importar términos de moderación:', error);
    process.exit(1);
});
