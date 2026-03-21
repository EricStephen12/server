const { sql } = require('./db/index');

async function migrateAdmin() {
    console.log('🚀 Starting Admin Role Migration...');
    try {
        // 1. Add is_admin column if it doesn't exist
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`;
        console.log('✅ Column is_admin added (or already exists).');

        // 2. Set admin for the creator
        const adminEmail = 'deamirclothingstores'; // Based on subagent login confirmation
        await sql`UPDATE users SET is_admin = TRUE WHERE email = ${adminEmail} OR name = ${adminEmail}`;
        console.log(`✅ Admin privileges granted to: ${adminEmail}`);

        // 3. Verify
        const admins = await sql`SELECT email, name, is_admin FROM users WHERE is_admin = TRUE`;
        console.log('👥 Current Admins:', admins);

    } catch (err) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        process.exit();
    }
}

migrateAdmin();
