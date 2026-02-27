require('dotenv').config();
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

async function runMigration() {
    console.log('🚀 Starting migration for missing user columns...');
    try {
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_videos_analyzed integer DEFAULT 0`;
        console.log('✅ Added total_videos_analyzed');

        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'inactive'`;
        console.log('✅ Added subscription_status');

        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_customer_id text`;
        console.log('✅ Added paddle_customer_id');

        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS next_billing_date timestamp with time zone`;
        console.log('✅ Added next_billing_date');

        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_scripts integer DEFAULT 0`;
        console.log('✅ Added total_scripts');

        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_pins integer DEFAULT 0`;
        console.log('✅ Added total_pins');

        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now()`;
        console.log('✅ Added updated_at');

        console.log('🎉 Migration complete!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
