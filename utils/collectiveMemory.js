/**
 * Collective Intelligence — anonymized global pattern ledger.
 *
 * NEVER persist: user ids, emails, video URLs, product/brand names,
 * transcripts, or chat. Only structural market patterns.
 */
const crypto = require('crypto');
const { sql } = require('../db/index');

const BANDS = ['low', 'mid', 'high'];

function scoreToBand(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'mid';
  if (n < 4) return 'low';
  if (n < 7) return 'mid';
  return 'high';
}

function normalizeNiche(raw) {
  const s = String(raw || 'general')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (s.slice(0, 80) || 'general');
}

function normalizeMode(dna) {
  if (dna?.mode === 'product-intel') return 'product-intel';
  if (dna?.mode === 'content' || dna?.mode === 'storytelling') return 'content';
  return 'ad';
}

function sanitizeTrigger(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Drop anything that looks like a brand / URL / email
  if (/https?:\/\//i.test(raw) || /@/.test(raw)) return null;
  const cleaned = raw.replace(/[^a-zA-Z0-9\s\-_/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2 || cleaned.length > 64) return null;
  return cleaned.toLowerCase();
}

function styleTagsFromDna(dna) {
  const tags = new Set();
  const style = dna?.vibe_assessment?.style || dna?.overall_style || dna?.style;
  if (typeof style === 'string' && style.length < 40) {
    tags.add(style.toLowerCase().replace(/\s+/g, '_').slice(0, 32));
  }
  const hasFace = dna?.has_face ?? dna?.visualAttributes?.hasFace;
  if (hasFace === true) tags.add('face_on_camera');
  if (hasFace === false) tags.add('no_face');
  const overlays = dna?.has_text_overlay ?? dna?.visualAttributes?.hasTextOverlay;
  if (overlays === true) tags.add('text_overlay');
  return Array.from(tags).slice(0, 8);
}

/**
 * Build an anonymized pattern card from completed analysis DNA.
 * @returns {object|null}
 */
function extractPattern(dna) {
  if (!dna || typeof dna !== 'object') return null;
  if (dna.status && dna.status !== 'completed') return null;

  const mode = normalizeMode(dna);
  const nicheKey = normalizeNiche(
    dna.niche || dna.category || dna.brandNiche || 'general'
  );

  let hookBand;
  let retentionBand;
  let conversionBand;
  let primaryTrigger = null;
  let awarenessLevel = null;
  let marketStage = null;
  let patternSummary;

  if (mode === 'product-intel') {
    hookBand = scoreToBand(dna.audiencePainFitScore);
    retentionBand = scoreToBand(dna.saturationScore);
    conversionBand = scoreToBand(dna.profitViabilityScore);
    marketStage = typeof dna.marketStage === 'string'
      ? dna.marketStage.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().slice(0, 48) || null
      : null;
    primaryTrigger = sanitizeTrigger(dna.marketPosition) || sanitizeTrigger(dna.verdict);
    patternSummary = [
      `Product-intel pattern in ${nicheKey}.`,
      marketStage ? `Market stage band: ${marketStage}.` : null,
      `Audience-fit ${hookBand}, saturation ${retentionBand}, viability ${conversionBand}.`,
      primaryTrigger ? `Positioning signal: ${primaryTrigger}.` : null,
    ].filter(Boolean).join(' ');
  } else {
    const metrics = dna.metrics || {};
    hookBand = scoreToBand(metrics.hook_power);
    retentionBand = scoreToBand(metrics.retention_score);
    conversionBand = scoreToBand(metrics.conversion_trigger);
    primaryTrigger = sanitizeTrigger(dna.psychology_breakdown?.primary_trigger)
      || sanitizeTrigger(dna.primary_trigger);
    awarenessLevel = typeof dna.awareness_level === 'string'
      ? dna.awareness_level.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().slice(0, 48) || null
      : null;
    const tags = styleTagsFromDna(dna);
    patternSummary = [
      `${mode === 'content' ? 'Organic/content' : 'Paid-ad'} pattern in ${nicheKey}.`,
      `Hook ${hookBand}, retention ${retentionBand}, conversion ${conversionBand}.`,
      primaryTrigger ? `Primary trigger: ${primaryTrigger}.` : null,
      awarenessLevel ? `Awareness: ${awarenessLevel}.` : null,
      tags.length ? `Style tags: ${tags.join(', ')}.` : null,
    ].filter(Boolean).join(' ');
  }

  const styleTags = styleTagsFromDna(dna);
  const fingerprintPayload = [
    mode,
    nicheKey,
    hookBand,
    retentionBand,
    conversionBand,
    primaryTrigger || '',
    awarenessLevel || '',
    marketStage || '',
    styleTags.slice().sort().join(','),
  ].join('|');

  const contentFingerprint = crypto
    .createHash('sha256')
    .update(fingerprintPayload)
    .digest('hex')
    .slice(0, 32);

  return {
    mode,
    nicheKey,
    hookBand,
    retentionBand,
    conversionBand,
    primaryTrigger,
    styleTags,
    awarenessLevel,
    marketStage,
    patternSummary: patternSummary.slice(0, 500),
    contentFingerprint,
  };
}

/**
 * Upsert a pattern by content_fingerprint. Soft-fails on DB errors.
 * @returns {Promise<{ ok: boolean, id?: string, reason?: string }>}
 */
async function upsertPattern(dna) {
  const pattern = extractPattern(dna);
  if (!pattern) {
    return { ok: false, reason: 'no_pattern' };
  }

  try {
    const rows = await sql`
      INSERT INTO collective_patterns (
        mode, niche_key, hook_band, retention_band, conversion_band,
        primary_trigger, style_tags, awareness_level, market_stage,
        pattern_summary, content_fingerprint, sighting_count, last_seen_at
      ) VALUES (
        ${pattern.mode},
        ${pattern.nicheKey},
        ${pattern.hookBand},
        ${pattern.retentionBand},
        ${pattern.conversionBand},
        ${pattern.primaryTrigger},
        ${pattern.styleTags},
        ${pattern.awarenessLevel},
        ${pattern.marketStage},
        ${pattern.patternSummary},
        ${pattern.contentFingerprint},
        1,
        NOW()
      )
      ON CONFLICT (content_fingerprint) DO UPDATE SET
        sighting_count = collective_patterns.sighting_count + 1,
        last_seen_at = NOW(),
        pattern_summary = EXCLUDED.pattern_summary,
        primary_trigger = COALESCE(EXCLUDED.primary_trigger, collective_patterns.primary_trigger),
        style_tags = EXCLUDED.style_tags
      RETURNING id, sighting_count
    `;
    return { ok: true, id: rows[0]?.id, sightings: rows[0]?.sighting_count };
  } catch (err) {
    console.warn('[CollectiveMemory] upsert failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Retrieve similar anonymized patterns for prompt injection.
 * @param {object} dna - current analysis DNA
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
async function retrieveRelevantPatterns(dna, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 10);
  const query = extractPattern(dna);
  if (!query) return [];

  try {
    // Prefer same niche+mode; boost matching trigger / nearby bands
    const rows = await sql`
      SELECT
        id, mode, niche_key, hook_band, retention_band, conversion_band,
        primary_trigger, style_tags, awareness_level, market_stage,
        pattern_summary, sighting_count, last_seen_at,
        (
          CASE WHEN niche_key = ${query.nicheKey} THEN 40 ELSE 0 END
          + CASE WHEN mode = ${query.mode} THEN 20 ELSE 0 END
          + CASE WHEN primary_trigger IS NOT NULL
              AND ${query.primaryTrigger} IS NOT NULL
              AND primary_trigger = ${query.primaryTrigger} THEN 25 ELSE 0 END
          + CASE WHEN hook_band = ${query.hookBand} THEN 8 ELSE 0 END
          + CASE WHEN retention_band = ${query.retentionBand} THEN 5 ELSE 0 END
          + CASE WHEN conversion_band = ${query.conversionBand} THEN 5 ELSE 0 END
          + LEAST(sighting_count, 20)
        ) AS relevance
      FROM collective_patterns
      WHERE niche_key = ${query.nicheKey}
         OR mode = ${query.mode}
      ORDER BY relevance DESC, last_seen_at DESC
      LIMIT ${limit}
    `;

    // Drop weak matches (e.g. only mode overlap with 1 sighting)
    return (rows || []).filter((r) => Number(r.relevance) >= 25);
  } catch (err) {
    console.warn('[CollectiveMemory] retrieve failed:', err.message);
    return [];
  }
}

/**
 * Format patterns for system-prompt injection.
 * @param {object[]} patterns
 * @returns {string}
 */
function formatCollectivePromptBlock(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return '';

  const lines = patterns.map((p, i) => {
    const n = i + 1;
    const sightings = p.sighting_count || 1;
    return `${n}. [${p.mode}/${p.niche_key}] hook=${p.hook_band} retention=${p.retention_band} conversion=${p.conversion_band}`
      + (p.primary_trigger ? ` trigger=${p.primary_trigger}` : '')
      + ` (seen ~${sightings}x). ${p.pattern_summary}`;
  });

  return `
COLLECTIVE EXPERIENCE (anonymized prior market patterns — NOT private user data):
Use this as institutional memory of similar situations. Speak like a veteran director who has seen the category before.
Rules:
- Do NOT invent brands, creators, URLs, or claim you analyzed a specific viral post unless it is in THIS session's DNA.
- Do NOT claim exact counts beyond what is listed. If the pack is thin, stay humble.
- Prefer structural advice (hooks, saturation, format) grounded in these patterns.

${lines.join('\n')}
`;
}

module.exports = {
  BANDS,
  scoreToBand,
  normalizeNiche,
  extractPattern,
  upsertPattern,
  retrieveRelevantPatterns,
  formatCollectivePromptBlock,
};
