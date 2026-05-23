require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { sql } = require('./db/index');

async function migrate() {
    try {
        console.log('Creating ad_benchmarks table...');
        await sql`
            CREATE TABLE IF NOT EXISTS ad_benchmarks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID,
                video_url TEXT,
                niche TEXT,
                hook_power DECIMAL(3,1),
                retention_score DECIMAL(3,1),
                conversion_trigger DECIMAL(3,1),
                awareness_level TEXT,
                style TEXT,
                primary_trigger TEXT,
                has_face BOOLEAN DEFAULT false,
                has_text_overlay BOOLEAN DEFAULT false,
                transcript_length INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `;
        console.log('✅ Table created!');

        console.log('Creating indexes...');
        await sql`CREATE INDEX IF NOT EXISTS idx_benchmarks_niche ON ad_benchmarks(niche)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_benchmarks_created ON ad_benchmarks(created_at)`;
        console.log('✅ Indexes created!');

        // Verify
        const count = await sql`SELECT count(*) FROM ad_benchmarks`;
        console.log('Current benchmark count:', count[0].count);

        process.exit(0);
    } catch (e) {
        console.error('Migration failed:', e.message);
        process.exit(1);
    }
}
migrate();
