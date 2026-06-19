'use strict';

const pool       = require('./pool');
const { logEvent } = require('../utils/logger');
const { seedModerationTermsIfEmpty } = require('../modules/moderation/moderation.repository');

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

    // Columns added iteratively — idempotent
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS text_original TEXT;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS text_censored TEXT;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS reply_to_id UUID NULL;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS reply_author TEXT NULL;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS reply_text TEXT NULL;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS forwarded_from_id UUID NULL;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS deleted_by UUID NULL;`);
    await pool.query(`ALTER TABLE global_messages  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);

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

    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS text_original TEXT;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS text_censored TEXT;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS reply_to_id UUID NULL;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS reply_author TEXT NULL;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS reply_text TEXT NULL;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS forwarded_from_id UUID NULL;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS deleted_by UUID NULL;`);
    await pool.query(`ALTER TABLE group_messages   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);

    await pool.query(`ALTER TABLE groups           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);
    await pool.query(`ALTER TABLE group_members    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';`);
    await pool.query(`ALTER TABLE group_members    ADD COLUMN IF NOT EXISTS hidden_for_user BOOLEAN NOT NULL DEFAULT FALSE;`);

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
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            display_name TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL DEFAULT '',
            avatar_url TEXT,
            avatar_data TEXT,
            banner_color TEXT NOT NULL DEFAULT '#fbbf24',
            bio TEXT NOT NULL DEFAULT '',
            pronouns TEXT NOT NULL DEFAULT '',
            custom_status TEXT NOT NULL DEFAULT '',
            presence_status TEXT NOT NULL DEFAULT 'online',
            status_emoji TEXT NOT NULL DEFAULT '',
            profile_effect TEXT NOT NULL DEFAULT '',
            nameplate_color TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    // Backfill text columns
    await pool.query(`UPDATE global_messages  SET text_original = text WHERE text_original IS NULL;`);
    await pool.query(`UPDATE global_messages  SET text_censored = text WHERE text_censored IS NULL;`);
    await pool.query(`UPDATE private_messages SET text_original = text WHERE text_original IS NULL;`);
    await pool.query(`UPDATE private_messages SET text_censored = text WHERE text_censored IS NULL;`);
    await pool.query(`UPDATE group_messages   SET text_original = text WHERE text_original IS NULL;`);
    await pool.query(`UPDATE group_messages   SET text_censored = text WHERE text_censored IS NULL;`);

    // Indices
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_global_messages_created_at    ON global_messages(created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_private_messages_users        ON private_messages(from_id, to_id, created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_group_messages_group_created  ON group_messages(group_id, created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_moderation_terms_active       ON moderation_terms(active, normalized_term);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_moderation_audit_created      ON moderation_audit(created_at DESC);`);

    await seedModerationTermsIfEmpty();
}

module.exports = { initDatabase };
