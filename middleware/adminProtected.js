const { requireAuth } = require('@clerk/express');
const { sql } = require('../db/index');

async function checkAdminStatus(req, res, next) {
    const userId = req.auth?.userId;

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: No valid session or user ID provided.' });
    }

    try {
        const [user] = await sql`SELECT id, is_admin, email, name FROM users WHERE id = ${userId}`;

        if (user && user.is_admin) {
            req.user = user;
            return next();
        }

        const ADMIN_EMAILS = ['deamirclothingstores@gmail.com', 'hello@eixora.store'];
        if (user && user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) {
            req.user = { ...user, is_admin: true };
            return next();
        }

        return res.status(403).json({ error: 'Forbidden: Admin access only.' });

    } catch (err) {
        console.error('Admin Auth Error:', err);
        res.status(500).json({ error: 'Security Engine failure during authentication.' });
    }
}

module.exports = [requireAuth(), checkAdminStatus];
