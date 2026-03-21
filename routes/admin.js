const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');
const authenticateClerk = require('../middleware/clerkAuth');
const adminOnly = require('../middleware/admin');

// Apply admin protection to all routes in this router
router.use(authenticateClerk);
router.use(adminOnly);

/**
 * GET /api/admin/stats
 * Global platform overview
 */
router.get('/stats', async (req, res) => {
    try {
        const [userCount] = await sql`SELECT count(*) FROM users`;
        const [scanCount] = await sql`SELECT sum(total_videos_analyzed) as total FROM profiles`;
        const planBreakdown = await sql`
            SELECT plan_type, count(*) as count 
            FROM profiles 
            GROUP BY plan_type
        `;

        res.json({
            totalUsers: parseInt(userCount.count),
            totalScans: parseInt(scanCount.total || 0),
            planBreakdown: planBreakdown.map(p => ({
                name: p.plan_type,
                value: parseInt(p.count)
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
        const users = await sql`
            SELECT 
                u.id, 
                u.email, 
                u.name, 
                p.plan_type, 
                p.subscription_status,
                p.total_videos_analyzed as scans,
                u.created_at
            FROM users u
            JOIN profiles p ON u.id = p.id
            ORDER BY u.created_at DESC
            LIMIT 100
        `;

        res.json(users);
    } catch (err) {
        console.error('Admin Users Error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

module.exports = router;
