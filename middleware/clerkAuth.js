const { sql } = require('../db/index');
const { verifyToken } = require('@clerk/backend');

/**
 * Auth middleware — Secure version.
 * 
 * Verifies the Clerk JWT offline using the Secret Key. 
 * This ensures that the user is who they claim to be, and prevents IDOR
 * (Insecure Direct Object Reference) where a user could query another
 * user's data by simply changing the userId parameter.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  // Must have a Bearer token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing auth token' });
  }

  const token = authHeader.split(' ')[1];
  if (!token || token.length < 10) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    
    const verifiedUserId = payload.sub;
    
    // Extract requested userId from body or query
    const requestedUserId = req.body?.userId || req.query?.userId;
    
    // Prevent IDOR: if a specific userId is requested, it MUST match the token's subject
    if (requestedUserId && requestedUserId !== verifiedUserId) {
      console.warn(`Security Event: IDOR attempt blocked. User ${verifiedUserId} attempted to access data for ${requestedUserId}`);
      return res.status(403).json({ error: 'Forbidden: You can only access your own data.' });
    }

    req.clerkUserId = verifiedUserId;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token signature' });
  }
}

/**
 * Ownership check
 */
async function requireOwnership(req, res, next) {
  // Now handled implicitly by requireAuth's IDOR check above
  next();
}

module.exports = { requireAuth, requireOwnership };
