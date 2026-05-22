require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { sql } = require('./db/index');

async function upgrade() {
    const email = 'deamirclothingstores@gmail.com';
    const clerkId = 'user_3DUZjBQKrfe36pp7hdeC0i3I0tb';
    try {
        await sql`
            UPDATE users 
            SET subscription_tier = 'agency', 
                subscription_status = 'active',
                total_videos_analyzed = 0
            WHERE email = ${email} OR clerk_id = ${clerkId}
        `;
        const updated = await sql`SELECT id, email, subscription_tier, clerk_id FROM users WHERE email = ${email} OR clerk_id = ${clerkId}`;
        console.log('✅ Done! Updated users:', updated);
        
        // Also delete any lounge sessions so the scan count goes back to 0
        for (const u of updated) {
            await sql`DELETE FROM lounge_sessions WHERE user_id = ${u.id}`;
        }
        console.log('✅ Reset scan counts (lounge sessions)!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}
upgrade();
