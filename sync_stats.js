const { sql } = require('./db/index');

async function syncStats() {
    try {
        console.log('🔄 Syncing user stats from table counts...');

        const users = await sql`SELECT id FROM users`;

        for (const user of users) {
            // Count analyzed videos (is_verified = true in ads table might be a good proxy, or just count all ads if they are user-specific)
            // But wait, are 'ads' global or user-specific? 
            // The code has a 'user_ids' column in some places? 
            // In index.js line 280, /api/save-to-vault takes a userId but inserts into 'ads' without a user_id column?
            // Let me check 'ads' columns.

            const adsColumns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ads'`;
            const hasUserId = adsColumns.some(c => c.column_name === 'user_id');

            let adsCount = 0;
            if (hasUserId) {
                const [res] = await sql`SELECT count(*) FROM ads WHERE user_id = ${user.id}`;
                adsCount = parseInt(res.count);
            }

            const scriptsColumns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'scripts'`;
            const scriptHasUserId = scriptsColumns.some(c => c.column_name === 'user_id');

            let scriptsCount = 0;
            if (scriptHasUserId) {
                const [res] = await sql`SELECT count(*) FROM scripts WHERE user_id = ${user.id}`;
                scriptsCount = parseInt(res.count);
            }

            console.log(`User ${user.id}: Ads=${adsCount}, Scripts=${scriptsCount}`);

            await sql`
                UPDATE users 
                SET total_videos_analyzed = ${adsCount}, 
                    total_scripts = ${scriptsCount}
                WHERE id = ${user.id}
            `;
        }

        console.log('✅ Stats sync complete!');
    } catch (err) {
        console.error('❌ Stats sync failed:', err);
    } finally {
        process.exit();
    }
}

syncStats();
