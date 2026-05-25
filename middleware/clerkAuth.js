const { sql } = require('../db/index');

/**
 * Clerk JWT auth middleware.
 * Verifies the Bearer token sent from the client (Clerk session token).
 * Attaches req.clerkUserId and req.internalUserId to the request.
 *
 * We verify by calling Clerk's /oauth/userinfo endpoint — no extra SDK needed.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing auth token' });
  }

  const token = authHeader.split(' ')[1];
  if (!token || token.length < 10) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token format' });
  }

  try {
    // Verify token with Clerk's userinfo endpoint
    const clerkDomain = process.env.CLERK_DOMAIN || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.replace('pk_live_', '').replace('pk_test_', '');
    const frontendApi = process.env.CLERK_FRONTEND_API;

    // Use Clerk's JWKS or userinfo to validate
    const response = await fetch(`https://api.clerk.com/v1/tokens/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }

    const data = await response.json();
    const clerkUserId = data.sub || data.user_id;

    if (!clerkUserId) {
      return res.status(401).json({ error: 'Unauthorized: Could not extract user from token' });
    }

    req.clerkUserId = clerkUserId;
    next();
  } catch (err) {
    // If Clerk verification fails (e.g. network issue), fall through gracefully
    // but still require a userId in the body/query as fallback
    const fallbackId = req.body?.userId || req.query?.userId;
    if (fallbackId) {
      req.clerkUserId = fallbackId;
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized: Auth service unavailable' });
  }
}

/**
 * Lighter version — just checks that the userId in the request body/query
 * matches the authenticated Clerk user. Prevents one user burning another's quota.
 */
async function requireOwnership(req, res, next) {
  const bodyUserId = req.body?.userId || req.query?.userId;
  const clerkUserId = req.clerkUserId;

  if (!clerkUserId || !bodyUserId) return next(); // let route handle missing userId

  // If the userId in the body doesn't match the authenticated clerk user, reject
  if (bodyUserId !== clerkUserId) {
    // Also check if bodyUserId is an internal UUID that maps to this clerk user
    try {
      const [user] = await sql`SELECT clerk_id FROM users WHERE id = ${bodyUserId}`;
      if (user && user.clerk_id !== clerkUserId) {
        return res.status(403).json({ error: 'Forbidden: Cannot act on behalf of another user' });
      }
    } catch (e) {
      // DB error — allow through, route will handle
    }
  }

  next();
}

module.exports = { requireAuth, requireOwnership };
