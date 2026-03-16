const { sql } = require('../db/index');

async function runMigration() {
    try {
        console.log('🚀 Running database migrations...');

        try {
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'inactive'`;
            console.log('✅ Added subscription_status column');
        } catch (e) {
            console.warn('⚠️ subscription_status column might already exist or error:', e.message);
        }

        try {
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_videos_analyzed integer DEFAULT 0`;
            console.log('✅ Added total_videos_analyzed column');
        } catch (e) {
            console.warn('⚠️ total_videos_analyzed column might already exist or error:', e.message);
        }

        console.log('🎊 Migrations complete!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
