const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');
const adminProtected = require('../middleware/adminProtected');

// Apply unified admin protection 🛡️💎
router.use(adminProtected);

/**
 * GET /api/admin/stats
 * Global platform overview
 */
router.get('/stats', async (req, res) => {
    try {
        const [userCount] = await sql`SELECT count(*) FROM users`;
        // Use COALESCE to handle NULL sums and target the 'users' table 🚀
        const [scanCount] = await sql`SELECT sum(total_videos_analyzed) as total FROM users`;
        const planBreakdown = await sql`
            SELECT subscription_tier as plan_type, count(*) as count 
            FROM users 
            GROUP BY subscription_tier
        `;

        res.json({
            totalUsers: parseInt(userCount.count || 0),
            totalScans: parseInt(scanCount.total || 0),
            planBreakdown: planBreakdown.map(p => ({
                name: p.plan_type || 'free',
                value: parseInt(p.count || 0)
            }))
        });
    } catch (err) {
        console.error('Admin Stats Error:', err);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});

/**
 * GET /api/admin/users
 * Detailed user list
 */
router.get('/users', async (req, res) => {
    try {
        // Simplified query to use only the 'users' table 💎
        const users = await sql`
            SELECT 
                id, 
                email, 
                name, 
                subscription_tier as plan_type, 
                total_videos_analyzed as scans,
                created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 100
        `;

        res.json(users);
    } catch (err) {
        console.error('Admin Users Error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * GET /api/admin/support
 * List all support tickets
 */
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
        console.error('Admin Support Error:', err);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

/**
 * PATCH /api/admin/support/:id/resolve
 */
router.patch('/support/:id/resolve', async (req, res) => {
    try {
        const { id } = req.params;
        await sql`UPDATE support_tickets SET status = 'resolved' WHERE id = ${id}`;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to resolve ticket' });
    }
});

/**
 * POST /api/admin/users/:id/update-tier
 */
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

/**
 * POST /api/admin/users/:id/add-credits
 */
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

module.exports = router;
