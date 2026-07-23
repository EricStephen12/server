const { verifyToken } = require('@clerk/backend');
const { sql } = require('../db/index');
const { resolveInternalId } = require('../utils/userResolver');

const ADMIN_EMAILS = ['deamirclothingstores@gmail.com', 'hello@eixora.store'];

async function adminProtected(req, res, next) {
    // 1. Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing auth token.' });
    }

    const token = authHeader.split(' ')[1];

    let clerkUserId;
    try {
        const payload = await verifyToken(token, {
            secretKey: process.env.CLERK_SECRET_KEY,
        });
        clerkUserId = payload.sub;
    } catch (err) {
        console.error('[Admin Auth] Token verification failed:', err.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }

    if (!clerkUserId) {
        return res.status(401).json({ error: 'Unauthorized: No user ID in token.' });
    }

    try {
        // 2. Ensure user is synced to DB
        await resolveInternalId(clerkUserId);

        // 3. Fetch user from Neon
        const [user] = await sql`
            SELECT id, is_admin, email, name 
            FROM users 
            WHERE clerk_id = ${clerkUserId}
        `;

        if (!user) {
            return res.status(403).json({ error: 'Forbidden: User not found in database.' });
        }

        // 4. Check is_admin flag (primary check)
        if (user.is_admin) {
            req.user = user;
            return next();
        }

        // 5. Self-healing: check against admin email list
        if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) {
            await sql`UPDATE users SET is_admin = true WHERE id = ${user.id}`;
            req.user = { ...user, is_admin: true };
            console.log(`[Admin Auth] Self-healed admin for ${user.email}`);
            return next();
        }

        console.warn(`[Admin Auth] Access denied for ${user.email} (clerk: ${clerkUserId})`);
        return res.status(403).json({ error: 'Forbidden: Admin access only.' });

    } catch (err) {
        console.error('[Admin Auth] Error:', err);
        return res.status(500).json({ error: 'Internal auth error.' });
    }
}

module.exports = adminProtected;
