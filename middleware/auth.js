const { sql } = require('../db/index');

/**
 * Middleware to verify NextAuth session on the Express backend.
 * It reads the session token from the cookie and checks the Neon database.
 */
async function authenticateSession(req, res, next) {
    // NextAuth uses different cookie names depending on environment (secure or not)
    const sessionToken =
        req.cookies['next-auth.session-token'] ||
        req.cookies['__Secure-next-auth.session-token'];

    if (!sessionToken) {
        return res.status(401).json({ error: 'Unauthorized: No session token found' });
    }

    try {
        // 1. Find the session and user in Neon
        const [session] = await sql`
      SELECT s.*, u.* 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_token = ${sessionToken}
      AND s.expires > ${new Date()}
    `;

        if (!session) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
        }

        // 2. Attach user to request object
        req.user = {
            id: session.user_id,
            email: session.email,
            name: session.name,
            subscription_tier: session.subscription_tier,
            credits_remaining: session.credits_remaining
        };

        next();
    } catch (err) {
        console.error('Auth Middleware Error:', err);
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
}

module.exports = authenticateSession;
