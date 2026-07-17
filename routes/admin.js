const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');
const adminProtected = require('../middleware/adminProtected');


router.use(adminProtected);


router.get('/stats', async (req, res) => {
    try {
        const [userCount] = await sql`SELECT count(*) FROM users`;
        const [scanCount] = await sql`SELECT sum(total_videos_analyzed) as total FROM users`;
        const [waitlistCount] = await sql`SELECT count(*)::int FROM waitlist`;
        const planBreakdown = await sql`
            SELECT subscription_tier as plan_type, count(*) as count 
            FROM users 
            GROUP BY subscription_tier
        `;

        // Signup counts by periods
        const [signupsDaily] = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '1 day'`;
        const [signupsWeekly] = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`;
        const [signupsMonthly] = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`;
        const [signupsYearly] = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '365 days'`;

        // Revenue counts by periods
        const [revDaily] = await sql`SELECT COALESCE(SUM(amount), 0)::int as total FROM payments WHERE created_at >= NOW() - INTERVAL '1 day'`;
        const [revWeekly] = await sql`SELECT COALESCE(SUM(amount), 0)::int as total FROM payments WHERE created_at >= NOW() - INTERVAL '7 days'`;
        const [revMonthly] = await sql`SELECT COALESCE(SUM(amount), 0)::int as total FROM payments WHERE created_at >= NOW() - INTERVAL '30 days'`;
        const [revYearly] = await sql`SELECT COALESCE(SUM(amount), 0)::int as total FROM payments WHERE created_at >= NOW() - INTERVAL '365 days'`;

        // Recent 30 days trends
        const signupTrend = await sql`
            SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, count(*)::int as count 
            FROM users 
            WHERE created_at >= NOW() - INTERVAL '30 days' 
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') 
            ORDER BY date ASC
        `;

        const revenueTrend = await sql`
            SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COALESCE(SUM(amount), 0)::int as amount 
            FROM payments 
            WHERE created_at >= NOW() - INTERVAL '30 days' 
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') 
            ORDER BY date ASC
        `;

        res.json({
            totalUsers: parseInt(userCount.count || 0),
            totalScans: parseInt(scanCount.total || 0),
            totalWaitlist: parseInt(waitlistCount.count || 0),
            planBreakdown: planBreakdown.map(p => ({
                name: p.plan_type || 'free',
                value: parseInt(p.count || 0)
            })),
            signups: {
                daily: signupsDaily.count || 0,
                weekly: signupsWeekly.count || 0,
                monthly: signupsMonthly.count || 0,
                yearly: signupsYearly.count || 0
            },
            revenue: {
                daily: (revDaily.total || 0) / 100,
                weekly: (revWeekly.total || 0) / 100,
                monthly: (revMonthly.total || 0) / 100,
                yearly: (revYearly.total || 0) / 100
            },
            signupTrend: signupTrend.map(t => ({ date: t.date, count: t.count })),
            revenueTrend: revenueTrend.map(t => ({ date: t.date, amount: t.amount / 100 }))
        });
    } catch (err) {
        console.error('Failed to fetch admin stats:', err);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});


router.get('/users', async (req, res) => {
    try {

        const users = await sql`
            SELECT 
                id, 
                email, 
                name, 
                subscription_tier as plan_type, 
                total_videos_analyzed as scans,
                brand_niche,
                primary_goal,
                source,
                credits_remaining,
                is_admin,
                status,
                created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 100
        `;

        res.json(users);
    } catch (err) {

        res.status(500).json({ error: 'Failed to fetch users' });
    }
});


router.get('/support', async (req, res) => {
    try {
        const tickets = await sql`
            SELECT t.*, u.name as user_name 
            FROM support_tickets t
            LEFT JOIN users u ON t.user_id = u.id
            ORDER BY t.created_at DESC
        `;
        res.json(tickets);
    } catch (err) {

        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});


router.get('/waitlist', async (req, res) => {
    try {
        const waitlist = await sql`
            SELECT id, email, platform, created_at
            FROM waitlist
            ORDER BY created_at DESC
        `;
        res.json(waitlist);
    } catch (err) {
        console.error('Failed to fetch waitlist:', err);
        res.status(500).json({ error: 'Failed to fetch waitlist' });
    }
});


router.patch('/support/:id/resolve', async (req, res) => {
    try {
        const { id } = req.params;
        await sql`UPDATE support_tickets SET status = 'resolved' WHERE id = ${id}`;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to resolve ticket' });
    }
});


router.post('/users/:id/update-tier', async (req, res) => {
    try {
        const { id } = req.params;
        const { tier } = req.body;
        await sql`UPDATE users SET subscription_tier = ${tier} WHERE id = ${id}`;
        res.json({ success: true, tier });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update user tier' });
    }
});


router.post('/users/:id/add-credits', async (req, res) => {
    try {
        const { id } = req.params;
        const { amount } = req.body;
        await sql`UPDATE users SET credits_remaining = credits_remaining + ${amount} WHERE id = ${id}`;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add credits' });
    }
});

router.post('/users/:id/make-admin', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_admin } = req.body;
        await sql`UPDATE users SET is_admin = ${is_admin} WHERE id = ${id}`;
        res.json({ success: true, is_admin });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update admin status' });
    }
});

router.post('/users/:id/update-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'active', 'suspended', 'blocked'
        await sql`UPDATE users SET status = ${status} WHERE id = ${id}`;
        res.json({ success: true, status });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update user status' });
    }
});

router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Due to CASCADE in Prisma, deleting the user will delete their sessions, accounts, scripts, etc.
        await sql`DELETE FROM users WHERE id = ${id}`;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

router.get('/prompt', async (req, res) => {
    try {
        const rows = await sql`SELECT value FROM system_settings WHERE key = 'ai_prompt'`;
        if (rows && rows.length > 0) {
            res.json({ prompt: JSON.parse(rows[0].value) });
        } else {
            res.json({ prompt: null });
        }
    } catch (err) {
        console.error('Failed to fetch prompt:', err);
        res.status(500).json({ error: 'Failed to fetch prompt' });
    }
});

router.post('/prompt', async (req, res) => {
    try {
        const { roleDescriptionAd, roleDescriptionContent, modeInstructionAd, modeInstructionContent, structureInstructions } = req.body;
        const promptJson = JSON.stringify({ roleDescriptionAd, roleDescriptionContent, modeInstructionAd, modeInstructionContent, structureInstructions });
        await sql`
            INSERT INTO system_settings (key, value)
            VALUES ('ai_prompt', ${promptJson})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `;
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save prompt:', err);
        res.status(500).json({ error: 'Failed to save prompt' });
    }
});

module.exports = router;
