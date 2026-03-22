const { createClerkClient } = require('@clerk/clerk-sdk-node');
const { sql } = require('../db/index');

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/**
 * Middleware to verify Clerk session on the Express backend.
 */
async function authenticateClerk(req, res, next) {
    // 1. Get token from cookies or Authorization header
    let sessionToken = req.cookies['__session'];

    // Fallback to Bearer token for API efficiency
    if (!sessionToken && req.headers.authorization) {
        sessionToken = req.headers.authorization.split(' ')[1];
    }

    if (!sessionToken) {
        return res.status(401).json({ error: 'Unauthorized: No session token found' });
    }

    try {
        // 2. Verify the session token with Clerk
        const session = await clerkClient.verifyToken(sessionToken);

        if (!session) {
            return res.status(401).json({ error: 'Unauthorized: Invalid session' });
        }

        const userId = session.sub;

        // 2. Fetch or Sync user from local database
        // We query by clerk_id as the primary identifier.
        let [user] = await sql`SELECT * FROM users WHERE clerk_id = ${userId}`;

        if (!user) {
            // Initial sync if user doesn't exist yet (Fallback for Webhooks)
            const clerkUser = await clerkClient.users.getUser(userId);
            const email = clerkUser.emailAddresses[0]?.emailAddress;
            const name = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username;
            const plan_type = clerkUser.publicMetadata.plan_type || 'free';
            const is_admin = clerkUser.publicMetadata.is_admin || false;

            [user] = await sql`
                INSERT INTO users (clerk_id, email, name, subscription_tier, is_admin, created_at)
                VALUES (${userId}, ${email}, ${name}, ${plan_type}, ${is_admin}, NOW())
                ON CONFLICT (email) DO UPDATE 
                SET clerk_id = ${userId}, 
                    subscription_tier = EXCLUDED.subscription_tier,
                    is_admin = EXCLUDED.is_admin
                RETURNING *
            `;
        }

        // 3. Attach user to request object
        req.user = {
            id: user.id,
            clerk_id: userId,
            email: user.email,
            name: user.name,
            subscription_tier: user.subscription_tier,
            is_admin: user.is_admin
        };

        next();
    } catch (err) {
        console.error('Clerk Auth Middleware Error:', err);
        res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
    }
}

module.exports = authenticateClerk;
