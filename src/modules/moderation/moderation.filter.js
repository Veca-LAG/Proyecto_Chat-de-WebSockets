'use strict';

const { sanitizeText } = require('../../utils/sanitize');

const FALLBACK_FORBIDDEN_TERMS = [
    'puta', 'puto', 'mierda', 'cabron', 'cabrón', 'pendejo', 'pendeja',
    'chingada', 'chingar', 'verga', 'pinche', 'culero', 'idiota',
    'imbecil', 'imbécil', 'estupido', 'estúpido', 'fuck', 'shit', 'bitch',
    'perra', 'perro', 'mensa', 'menso', 'malcriada', 'malcriado', 'invesil'
];

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTermForModeration(term) {
    return String(term || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
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
    const wordPattern = normalized.split('').map((c) => getCharacterPattern(c) + '+').join(sep);

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
                countryCode:  row.country_code || 'ALL',
                severity:     row.severity     || 'medium',
                category:     row.category     || 'profanity',
                source:       row.source       || 'fallback',
                active:       row.active !== false
            });
        }
    }

    return [...byKey.values()].sort((a, b) => b.normalizedTerm.length - a.normalizedTerm.length);
}

function fallbackModerationTerms() {
    return normalizeTerms(
        FALLBACK_FORBIDDEN_TERMS.map((term) => ({
            term,
            country_code: 'ALL',
            severity:     'medium',
            category:     'profanity',
            source:       'fallback'
        }))
    );
}

function compileModerationRegexList(terms) {
    return terms
        .map((item) => ({ term: item.term, regex: buildLooseWordRegex(item.term) }))
        .filter((item) => item.regex);
}

module.exports = {
    FALLBACK_FORBIDDEN_TERMS,
    escapeRegExp,
    normalizeTermForModeration,
    getCharacterPattern,
    buildLooseWordRegex,
    normalizeTerms,
    fallbackModerationTerms,
    compileModerationRegexList
};
