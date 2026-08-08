/**
 * Ephemeral Director Frames — timestamp metadata only (no image storage).
 * Frontend seeks the live video to these times while Voice Lounge speaks.
 */

function parseTimestampSeconds(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d+(?:\.\d+)?)\s*s?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function parseSecondsFromText(text) {
  if (typeof text !== 'string') return null;
  // "Frame 3 at 12.0s" or "at 3s"
  const m = text.match(/(?:at\s+)?(\d+(?:\.\d+)?)\s*s\b/i)
    || text.match(/Frame\s+\d+\s+at\s+(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function pushTrigger(out, seen, trigger) {
  if (!trigger || trigger.timestamp_seconds == null) return;
  const t = Number(trigger.timestamp_seconds);
  if (!Number.isFinite(t) || t < 0) return;
  const key = t.toFixed(1);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    timestamp_seconds: Number(t.toFixed(2)),
    label: String(trigger.label || `Frame @ ${key}s`).slice(0, 80),
    reason_key: String(trigger.reason_key || 'moment').slice(0, 40),
  });
}

/**
 * Attach visual_triggers[] to completed DNA. Mutates and returns dna.
 * @param {object} dna
 * @param {Array<{ timestamp?: number, phase?: string }>|null} frames
 */
function attachVisualTriggers(dna, frames = null) {
  if (!dna || typeof dna !== 'object') return dna;
  if (dna.status && dna.status !== 'completed') return dna;

  const out = [];
  const seen = new Set();

  const frameList = Array.isArray(frames) ? frames : [];
  const hookFrame = frameList.find((f) => f.phase === 'hook') || frameList[0];
  if (hookFrame && typeof hookFrame.timestamp === 'number') {
    pushTrigger(out, seen, {
      timestamp_seconds: hookFrame.timestamp,
      label: `Hook Frame (${hookFrame.timestamp}s)`,
      reason_key: 'hook',
    });
  }

  const moneyTs = parseTimestampSeconds(dna.money_shot?.timestamp);
  if (moneyTs != null) {
    pushTrigger(out, seen, {
      timestamp_seconds: moneyTs,
      label: `Money Shot (${moneyTs}s)`,
      reason_key: 'money_shot',
    });
  }

  const peaks = dna.retention_map?.attention_peaks;
  if (Array.isArray(peaks)) {
    for (const peak of peaks.slice(0, 2)) {
      const ts = parseSecondsFromText(peak) ?? parseTimestampSeconds(peak);
      if (ts == null) continue;
      pushTrigger(out, seen, {
        timestamp_seconds: ts,
        label: `Attention Peak (${ts}s)`,
        reason_key: 'attention_peak',
      });
    }
  }

  const dead = dna.retention_map?.dead_zones;
  if (Array.isArray(dead) && dead[0]) {
    const ts = parseSecondsFromText(dead[0]);
    if (ts != null) {
      pushTrigger(out, seen, {
        timestamp_seconds: ts,
        label: `Dead Zone (${ts}s)`,
        reason_key: 'dead_zone',
      });
    }
  }

  const ctaFrame = frameList.find((f) => f.phase === 'cta') || frameList[frameList.length - 1];
  if (ctaFrame && typeof ctaFrame.timestamp === 'number' && out.length < 6) {
    pushTrigger(out, seen, {
      timestamp_seconds: ctaFrame.timestamp,
      label: `Close / CTA (${ctaFrame.timestamp}s)`,
      reason_key: 'cta',
    });
  }

  // Product-intel: use early / mid frames as structural callouts
  if (dna.mode === 'product-intel' && frameList.length) {
    const mid = frameList[Math.floor(frameList.length / 2)];
    if (mid?.timestamp != null) {
      pushTrigger(out, seen, {
        timestamp_seconds: mid.timestamp,
        label: `Product Reveal (${mid.timestamp}s)`,
        reason_key: 'product_reveal',
      });
    }
  }

  dna.visual_triggers = out.slice(0, 6);
  return dna;
}

module.exports = {
  attachVisualTriggers,
  parseTimestampSeconds,
  parseSecondsFromText,
};
