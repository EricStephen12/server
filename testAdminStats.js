const { sql } = require('../server/db/index');
const dotenv = require('dotenv');
dotenv.config({ path: '../server/.env' });

async function run() {
    try {
        console.log("Testing userCount...");
        const [userCount] = await sql`SELECT count(*) FROM users`;
        console.log("userCount:", userCount);

        console.log("Testing scanCount...");
        const [scanCount] = await sql`SELECT sum(total_videos_analyzed) as total FROM users`;
        console.log("scanCount:", scanCount);

        console.log("Testing waitlistCount...");
        const [waitlistCount] = await sql`SELECT count(*)::int FROM waitlist`;
        console.log("waitlistCount:", waitlistCount);

        console.log("Testing planBreakdown...");
        const planBreakdown = await sql`
            SELECT subscription_tier as plan_type, count(*) as count 
            FROM users 
            GROUP BY subscription_tier
        `;
        console.log("planBreakdown:", planBreakdown);

        console.log("Testing signups...");
        const [signupsDaily] = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '1 day'`;
        console.log("signupsDaily:", signupsDaily);

        console.log("Testing payments...");
        const [revDaily] = await sql`SELECT COALESCE(SUM(amount), 0)::int as total FROM payments WHERE created_at >= NOW() - INTERVAL '1 day'`;
        console.log("revDaily:", revDaily);

        console.log("Testing signupTrend...");
        const signupTrend = await sql`
            SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, count(*)::int as count 
            FROM users 
            WHERE created_at >= NOW() - INTERVAL '30 days' 
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') 
            ORDER BY date ASC
        `;
        console.log("signupTrend:", signupTrend);

        console.log("Testing revenueTrend...");
        const revenueTrend = await sql`
            SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COALESCE(SUM(amount), 0)::int as amount 
            FROM payments 
            WHERE created_at >= NOW() - INTERVAL '30 days' 
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') 
            ORDER BY date ASC
        `;
        console.log("revenueTrend:", revenueTrend);

        console.log("ALL QUERIES SUCCEEDED");
    } catch (err) {
        console.error("QUERY FAILED:", err);
        process.exit(1);
    }
}
run();
