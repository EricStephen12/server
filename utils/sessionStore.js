const { sql } = require('../db/index');
const crypto = require('crypto');

// In-memory LRU session store for fallback when PostgreSQL/Neon is unreachable or quota exceeded
const inMemorySessions = new Map();

async function createSession({ userId, title, videoUrl, dna, messages }) {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const sessionObj = {
    id: sessionId,
    user_id: userId,
    title: title || 'Analysis Session',
    video_url: videoUrl || '',
    dna: dna || { status: 'processing' },
    messages: messages || [],
    created_at: now,
    updated_at: now,
  };

  // Always keep in memory cache
  inMemorySessions.set(sessionId, sessionObj);

  // Clean old entries if memory exceeds 300 sessions
  if (inMemorySessions.size > 300) {
    const firstKey = inMemorySessions.keys().next().value;
    inMemorySessions.delete(firstKey);
  }

  // Try saving to database
  try {
    const [row] = await sql`
      INSERT INTO lounge_sessions(id, user_id, title, video_url, dna, messages, created_at, updated_at)
      VALUES(${sessionId}, ${userId}, ${sessionObj.title}, ${sessionObj.video_url}, ${JSON.stringify(sessionObj.dna)}, ${JSON.stringify(sessionObj.messages)}, NOW(), NOW())
      RETURNING id, user_id, title, video_url, dna, messages, created_at, updated_at
    `;
    if (row) return row;
  } catch (err) {
    console.warn(`[SessionStore] DB insert failed (${err.message}). Using memory session: ${sessionId}`);
  }

  return sessionObj;
}

async function getSession(sessionId) {
  if (!sessionId) return null;

  // 1. Try DB first
  try {
    const [row] = await sql`SELECT * FROM lounge_sessions WHERE id = ${sessionId}`;
    if (row) {
      if (typeof row.dna === 'string') {
        try { row.dna = JSON.parse(row.dna); } catch(e){}
      }
      if (typeof row.messages === 'string') {
        try { row.messages = JSON.parse(row.messages); } catch(e){}
      }
      inMemorySessions.set(sessionId, row);
      return row;
    }
  } catch (err) {
    console.warn(`[SessionStore] DB get failed (${err.message}). Checking memory cache...`);
  }

  // 2. Fallback to memory cache
  if (inMemorySessions.has(sessionId)) {
    const cached = inMemorySessions.get(sessionId);
    return cached;
  }

  return null;
}

async function updateSessionDna(sessionId, dna) {
  if (!sessionId) return;

  // Update in memory cache
  if (inMemorySessions.has(sessionId)) {
    const s = inMemorySessions.get(sessionId);
    s.dna = dna;
    s.updated_at = new Date();
    inMemorySessions.set(sessionId, s);
  } else {
    inMemorySessions.set(sessionId, { id: sessionId, dna, updated_at: new Date() });
  }

  // Update in database
  try {
    await sql`
      UPDATE lounge_sessions
      SET dna = ${JSON.stringify(dna)}, updated_at = NOW()
      WHERE id = ${sessionId}
    `;
  } catch (err) {
    console.warn(`[SessionStore] DB update failed (${err.message}). Updated in memory.`);
  }
}

async function updateSessionMessages(sessionId, userId, messages) {
  if (!sessionId) return null;

  if (inMemorySessions.has(sessionId)) {
    const s = inMemorySessions.get(sessionId);
    s.messages = messages;
    s.updated_at = new Date();
    inMemorySessions.set(sessionId, s);
  }

  try {
    const [row] = await sql`
      UPDATE lounge_sessions
      SET messages = ${JSON.stringify(messages)}, updated_at = NOW()
      WHERE id = ${sessionId} AND user_id = ${userId}
      RETURNING *
    `;
    if (row) return row;
  } catch (err) {
    console.warn(`[SessionStore] DB message update failed (${err.message}).`);
  }

  return inMemorySessions.get(sessionId) || null;
}

module.exports = {
  createSession,
  getSession,
  updateSessionDna,
  updateSessionMessages,
  inMemorySessions,
};
