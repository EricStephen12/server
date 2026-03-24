const jwt = require('jsonwebtoken');
const { sql } = require('../db/index');
const { createClerkClient } = require('@clerk/clerk-sdk-node');
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/**
 * Combined Admin Protection Middleware 💎🛡️
 * Checks for BOTH:
 * 1. Dedicated Admin JWT (Master Admin)
 * 2. Clerk Session with Admin Status (Database Profile check)
 */
async function adminProtected(req, res, next) {
    let sessionToken = req.cookies['admin_token'] || req.cookies['__session'];

    // 1. Fallback to Authorization Header 🚀
    if (!sessionToken && req.headers.authorization) {
        sessionToken = req.headers.authorization.split(' ')[1];
    }

    if (!sessionToken) {
        return res.status(401).json({ error: 'Unauthorized: No session token found' });
    }

    try {
        // 2. CHECK FOR MASTER ADMIN JWT FIRST 🔓
        try {
            const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
            if (decoded && decoded.role === 'master_admin') {
                req.user = { id: 'master_admin', email: 'admin@eixora.ai', is_admin: true, is_master_admin: true };
                return next();
            }
        } catch (jwtErr) {
            // Not a Master Admin JWT, proceed to Clerk check
        }

        // 3. CHECK FOR CLERK SESSION 🛡️
        try {
            const session = await clerkClient.verifyToken(sessionToken);
            const userId = session.sub;

            // Verify Admin status in database
            const [user] = await sql`SELECT is_admin, email, name FROM users WHERE clerk_id = ${userId}`;

            if (!user || !user.is_admin) {
                console.warn(`🚨 Admin access denied for unauthorized user: ${userId}`);
                return res.status(403).json({ error: 'Forbidden: Admin access only.' });
            }

            req.user = { ...user, id: userId, clerk_id: userId };
            return next();
        } catch (clerkErr) {
            return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
        }

    } catch (err) {
        console.error('Admin Auth Error:', err);
        res.status(500).json({ error: 'Security Engine failure during authentication.' });
    }
}

module.exports = adminProtected;
