const { sql } = require('./db/index');

async function migrate() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS scan_events (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('✅ scan_events table created');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_scan_events_user_created ON scan_events (user_id, created_at)
    `;
    console.log('✅ index created');

    // Backfill: seed scan_events from total_videos_analyzed so existing users don't lose their count
    // We can't know exact dates, so we skip backfill — counts reset to 0 for the current month
    // which is actually correct since we don't have historical per-scan timestamps

    console.log('✅ Migration complete. Note: monthly scan counts start fresh from now.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit(0);
  }
}

migrate();
