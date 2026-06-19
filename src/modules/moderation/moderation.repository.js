'use strict';

const fs                  = require('fs');
const pool                = require('../../db/pool');
const { publishCluster }  = require('../../redis/publisher');
const { sanitizeText }    = require('../../utils/sanitize');
const { logEvent }        = require('../../utils/logger');
const { SERVER_ID, MODERATION_TERMS_SEED_FILE, MODERATION_RELOAD_EVENT } = require('../../config');
const {
    normalizeTerms,
    fallbackModerationTerms
} = require('./moderation.filter');

function loadSeedModerationTerms() {
    try {
        if (!fs.existsSync(MODERATION_TERMS_SEED_FILE)) return [];
        const raw    = fs.readFileSync(MODERATION_TERMS_SEED_FILE, 'utf8');
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
    const terms     = seedTerms.length ? seedTerms : fallbackModerationTerms();

    for (const item of terms) {
        await pool.query(
            `INSERT INTO moderation_terms
             (term, normalized_term, language, country_code, severity, category, source, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (normalized_term, country_code) DO UPDATE
             SET term         = EXCLUDED.term,
                 severity     = EXCLUDED.severity,
                 category     = EXCLUDED.category,
                 source       = EXCLUDED.source,
                 updated_at   = NOW()`,
            [item.term, item.normalizedTerm, 'es', item.countryCode, item.severity, item.category, item.source, item.active !== false]
        );
    }

    logEvent(`Moderación sembrada en PostgreSQL: ${terms.length} términos base.`);
}

async function getUserModerationPreference(userId) {
    const result = await pool.query(
        `SELECT censorship_enabled FROM user_moderation_preferences WHERE user_id = $1 LIMIT 1`,
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

module.exports = {
    loadSeedModerationTerms,
    seedModerationTermsIfEmpty,
    getUserModerationPreference,
    setUserModerationPreference,
    saveModerationAudit,
    notifyModerationTermsUpdated
};
