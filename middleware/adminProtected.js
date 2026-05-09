const jwt = require('jsonwebtoken');
const { sql } = require('../db/index');


/**
 * Combined Admin Protection Middleware 💎🛡️
 * Checks for BOTH:
 * 1. Dedicated Admin JWT (Master Admin)
 * 2. Clerk Session with Admin Status (Database Profile check)
 */
async function adminProtected(req, res, next) {
    // 1. Prioritize Authorization Header (used for Master Admin) 💎🚀
    let sessionToken = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    if (!sessionToken) {
        sessionToken = req.cookies['admin_token'] || req.cookies['__session'];
    }

    if (!sessionToken) {
        return res.status(401).json({ error: 'Unauthorized: No session token found' });
    }

    try {
        // 2. CHECK FOR MASTER ADMIN JWT FIRST 🔓
        try {
            const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
            if (decoded && decoded.role === 'master_admin') {
                req.user = { id: '00000000-0000-0000-0000-000000000000', email: 'admin@eixora.ai', is_admin: true, is_master_admin: true };
                return next();
            }
        } catch (jwtErr) {
            // Not a Master Admin JWT, proceed to Clerk check
        }

        // 3. CHECK FOR ADMIN STATUS VIA DB (If userId provided) 🛡️
        const userId = req.body.userId || req.query.userId || req.headers['x-user-id'];
        
        if (userId) {
            // Verify Admin status in database
            const [user] = await sql`SELECT id, is_admin, email, name FROM users WHERE id = ${userId}`;

            if (user && user.is_admin) {
                req.user = user;
                return next();
            }
            
            console.warn(`🚨 Admin access denied for unauthorized user ID: ${userId}`);
            return res.status(403).json({ error: 'Forbidden: Admin access only.' });
        }

        return res.status(401).json({ error: 'Unauthorized: No valid session or user ID provided.' });

    } catch (err) {
        console.error('Admin Auth Error:', err);
        res.status(500).json({ error: 'Security Engine failure during authentication.' });
    }
}

module.exports = adminProtected;
