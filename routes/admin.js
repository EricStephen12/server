const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');
const adminProtected = require('../middleware/adminProtected');


router.use(adminProtected);


router.get('/stats', async (req, res) => {
    try {
        // ── Totals ────────────────────────────────────────────────────────────
        const [userCount]    = await sql`SELECT count(*)::int FROM users`;
        const [scanCount]    = await sql`SELECT COALESCE(sum(total_videos_analyzed), 0)::int as total FROM users`;
        const [waitlistCount]= await sql`SELECT count(*)::int FROM waitlist`;

        // ── Plan breakdown ────────────────────────────────────────────────────
        const planBreakdown = await sql`
            SELECT COALESCE(subscription_tier, 'free') as plan_type, count(*)::int as count
            FROM users
            GROUP BY COALESCE(subscription_tier, 'free')
            ORDER BY count DESC
        `;

        // ── Signups — current period ──────────────────────────────────────────
        const [signupsToday]  = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '1 day'`;
        const [signupsWeek]   = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`;
        const [signupsMonth]  = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`;
        const [signupsYear]   = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '365 days'`;

        // ── Signups — previous period (for % change) ─────────────────────────
        const [signupsPrevToday] = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '2 days'  AND created_at < NOW() - INTERVAL '1 day'`;
        const [signupsPrevWeek]  = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days'`;
        const [signupsPrevMonth] = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'`;
        const [signupsPrevYear]  = await sql`SELECT count(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '730 days'AND created_at < NOW() - INTERVAL '365 days'`;

        // ── Revenue — current period ──────────────────────────────────────────
        const [revToday] = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '1 day'`;
        const [revWeek]  = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '7 days'`;
        const [revMonth] = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '30 days'`;
        const [revYear]  = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '365 days'`;

        // ── Revenue — previous period (for % change) ─────────────────────────
        const [revPrevToday] = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '2 days'  AND created_at < NOW() - INTERVAL '1 day'`;
        const [revPrevWeek]  = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days'`;
        const [revPrevMonth] = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'`;
        const [revPrevYear]  = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as total FROM payments WHERE created_at >= NOW() - INTERVAL '730 days'AND created_at < NOW() - INTERVAL '365 days'`;

        // ── Scans per period ──────────────────────────────────────────────────
        const [scansToday] = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '1 day'`;
        const [scansWeek]  = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '7 days'`;
        const [scansMonth] = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '30 days'`;
        const [scansYear]  = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '365 days'`;

        // Previous scans
        const [scansPrevToday] = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '2 days'  AND created_at < NOW() - INTERVAL '1 day'`;
        const [scansPrevWeek]  = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days'`;
        const [scansPrevMonth] = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'`;
        const [scansPrevYear]  = await sql`SELECT count(*)::int FROM scan_events WHERE created_at >= NOW() - INTERVAL '730 days'AND created_at < NOW() - INTERVAL '365 days'`;

        // ── Daily trend for sparklines (last 30 days) ─────────────────────────
        const signupTrend = await sql`
            SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as date,
                   count(*)::int as count
            FROM users
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY date ASC
        `;

        const revenueTrend = await sql`
            SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as date,
                   COALESCE(SUM(amount), 0)::bigint as amount
            FROM payments
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY date ASC
        `;

        // ── Recent payments (last 10) ─────────────────────────────────────────
        const recentPayments = await sql`
            SELECT p.amount, p.created_at, u.name, u.email, u.subscription_tier
            FROM payments p
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC
            LIMIT 10
        `;

        // ── Recent signups (last 10) ──────────────────────────────────────────
        const recentSignups = await sql`
            SELECT id, name, email, subscription_tier, created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 10
        `;

        // ── Helper: safe % change ─────────────────────────────────────────────
        const pct = (curr, prev) => {
            if (!prev || prev === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };

        const cents = (v) => Math.round((Number(v) || 0) / 100);

        res.json({
            // Totals
            totalUsers:    userCount.count    || 0,
            totalScans:    scanCount.total    || 0,
            totalWaitlist: waitlistCount.count|| 0,

            // Plan mix
            planBreakdown: planBreakdown.map(p => ({
                name:  p.plan_type,
                value: p.count
            })),

            // Period metrics
            signups: {
                today:   signupsToday.count  || 0,
                weekly:  signupsWeek.count   || 0,
                monthly: signupsMonth.count  || 0,
                yearly:  signupsYear.count   || 0,
                change: {
                    today:   pct(signupsToday.count,  signupsPrevToday.count),
                    weekly:  pct(signupsWeek.count,   signupsPrevWeek.count),
                    monthly: pct(signupsMonth.count,  signupsPrevMonth.count),
                    yearly:  pct(signupsYear.count,   signupsPrevYear.count),
                }
            },
            revenue: {
                today:   cents(revToday.total),
                weekly:  cents(revWeek.total),
                monthly: cents(revMonth.total),
                yearly:  cents(revYear.total),
                change: {
                    today:   pct(cents(revToday.total),  cents(revPrevToday.total)),
                    weekly:  pct(cents(revWeek.total),   cents(revPrevWeek.total)),
                    monthly: pct(cents(revMonth.total),  cents(revPrevMonth.total)),
                    yearly:  pct(cents(revYear.total),   cents(revPrevYear.total)),
                }
            },
            scans: {
                today:   scansToday.count  || 0,
                weekly:  scansWeek.count   || 0,
                monthly: scansMonth.count  || 0,
                yearly:  scansYear.count   || 0,
                change: {
                    today:   pct(scansToday.count,  scansPrevToday.count),
                    weekly:  pct(scansWeek.count,   scansPrevWeek.count),
                    monthly: pct(scansMonth.count,  scansPrevMonth.count),
                    yearly:  pct(scansYear.count,   scansPrevYear.count),
                }
            },

            // Trend sparklines
            signupTrend:  signupTrend.map(t  => ({ date: t.date, count: t.count })),
            revenueTrend: revenueTrend.map(t => ({ date: t.date, amount: Math.round(Number(t.amount) / 100) })),

            // Activity feeds
            recentPayments: recentPayments.map(p => ({
                amount:   Math.round(Number(p.amount) / 100),
                name:     p.name  || 'Unknown',
                email:    p.email || '',
                plan:     p.subscription_tier || 'free',
                date:     p.created_at,
            })),
            recentSignups: recentSignups.map(u => ({
                name:  u.name  || 'Anonymous',
                email: u.email || '',
                plan:  u.subscription_tier || 'free',
                date:  u.created_at,
            })),
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
