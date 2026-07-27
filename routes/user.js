const express = require('express');
const bcrypt = require('bcryptjs');

const { sql } = require('../db/index');
const { resolveInternalId } = require('../utils/userResolver');

const router = express.Router();

// Simple plan limits
const PLAN_LIMITS = { free: 3, creator: 30, studio: 250, agency: 250, founding: 30 };

router.get('/me', async (req, res) => {
  // Check if it's the custom JWT master admin token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const jwt = require('jsonwebtoken');
      if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not configured');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.role === 'master_admin') {
        return res.json({
          id: '00000000-0000-0000-0000-000000000000',
          name: 'Elite Master Admin',
          email: 'hello@eixora.store',
          is_admin: true,
          is_master_admin: true,
          plan_type: 'studio',
          subscription_tier: 'studio',
          credits_remaining: 99999,
          total_scripts: 0,
          total_pins: 0,
          total_videos_analyzed: 0,
          onboarding_completed: true
        });
      }
    } catch (err) {
      // Not a master admin JWT — validate as Clerk token below
    }

    // Validate Clerk token and enforce that the requested userId matches the token
    try {
      const { verifyToken } = require('@clerk/backend');
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      const clerkUserId = payload.sub;

      let userId = req.query.userId;
      // If the requested userId is a UUID it may already be resolved — allow it
      // Otherwise it must match the clerk ID from the token
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId) && userId !== clerkUserId) {
        return res.status(403).json({ error: 'Forbidden: token does not match requested user' });
      }
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
  } else {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }

  let userId = req.query.userId;
  const { email, name } = req.query;

  userId = await resolveInternalId(userId, { email, name });
  if (!userId) return res.status(404).json({ error: 'User not found' });

  try {
    const [user] = await sql`
      SELECT
        id, name, email, image,
        subscription_tier as "subscriptionTier",
        credits_remaining as "creditsRemaining",
        total_scripts as "totalScripts",
        total_pins as "totalPins",
        total_videos_analyzed as "totalVideosAnalyzed",
        onboarding_completed as "onboardingCompleted",
        brand_niche as "brandNiche",
        primary_goal as "primaryGoal",
        created_at as "createdAt"
      FROM users
      WHERE id = ${userId}
    `;

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Monthly usage — count scan_events since the start of the current billing cycle.
    // Billing cycle resets monthly from the user's subscription_start_date (or created_at).
    // This matches how Stripe/Polar billing works — same day each month, not a rolling 30 days.
    const cycleAnchor = new Date(user.createdAt || new Date());
    const now = new Date();

    // Find the most recent billing cycle start (same day of month as anchor, in current/previous month)
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), cycleAnchor.getDate());
    if (cycleStart > now) {
      // We're before this month's reset day — use last month's reset
      cycleStart.setMonth(cycleStart.getMonth() - 1);
    }

    const [{ count: monthlyScans }] = await sql`
      SELECT count(*)::int FROM scan_events
      WHERE user_id = ${userId} AND created_at >= ${cycleStart}
    `.catch(() => [{ count: 0 }]);
    const [{ count: monthlyScripts }] = await sql`
      SELECT count(*)::int FROM scripts
      WHERE user_id = ${userId} AND created_at >= ${cycleStart}
    `.catch(() => [{ count: 0 }]);

    // Normalize tier
    let tier = user.subscriptionTier || 'free';
    if (tier === 'agency') tier = 'studio';
    if (tier === 'founding') tier = 'creator';

const { ADMIN_EMAILS } = require('../utils/adminEmails');

    const userIsAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      plan_type: tier,
      subscription_tier: tier,
      credits_remaining: user.creditsRemaining,
      total_scripts: user.totalScripts,
      total_pins: user.totalPins,
      total_videos_analyzed: user.totalVideosAnalyzed,
      onboarding_completed: user.onboardingCompleted,
      brand_niche: user.brandNiche,
      primary_goal: user.primaryGoal,
      created_at: user.createdAt,
      is_admin: userIsAdmin,
      monthly_usage: {
        scans: monthlyScans ?? 0,
        scripts: monthlyScripts ?? 0,
        cycle_start: cycleStart.toISOString(),
        cycle_reset_day: cycleAnchor.getDate(), // day of month the count resets
      }
    });
  } catch (err) {
    console.error('[/me] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/me', async (req, res) => {
  // Verify Clerk token before allowing profile updates
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }
  try {
    const { verifyToken } = require('@clerk/backend');
    const token = authHeader.split(' ')[1];
    await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }

  let { userId, name, email, onboarding_completed, brand_niche, primary_goal, source } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId, { email, name });
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  try {
    const [updatedUser] = await sql`
      UPDATE users 
      SET 
        name = COALESCE(${name !== undefined ? name : sql`name`}, name),
        onboarding_completed = COALESCE(${onboarding_completed !== undefined ? onboarding_completed : sql`onboarding_completed`}, onboarding_completed),
        brand_niche = COALESCE(${brand_niche !== undefined ? brand_niche : sql`brand_niche`}, brand_niche),
        primary_goal = COALESCE(${primary_goal !== undefined ? primary_goal : sql`primary_goal`}, primary_goal),
        source = COALESCE(${source !== undefined ? source : sql`source`}, source)
      WHERE id = ${userId}
      RETURNING 
        id, name, email, image, 
        subscription_tier as "subscriptionTier", 
        credits_remaining as "creditsRemaining",
        total_scripts as "totalScripts", 
        total_pins as "totalPins",
        onboarding_completed as "onboardingCompleted", 
        brand_niche as "brandNiche", 
        primary_goal as "primaryGoal", 
        source
    `;

    let tier = updatedUser.subscriptionTier || 'free';
    if (tier === 'agency') tier = 'studio';

    res.json({
      ...updatedUser,
      plan_type: tier,
      subscription_tier: tier,
      onboarding_completed: updatedUser.onboardingCompleted,
      brand_niche: updatedUser.brandNiche,
      primary_goal: updatedUser.primaryGoal
    });
  } catch (err) {
    console.error("Failed to update profile:", err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/plan-check', async (req, res) => {
  let userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  try {
    const [user] = await sql`
      SELECT 
        subscription_tier as "subscriptionTier",
        total_videos_analyzed as "totalVideosAnalyzed",
        total_scripts as "totalScripts"
      FROM users
      WHERE id = ${userId}
    `;

    if (!user) return res.status(404).json({ error: 'User not found' });

    let tier = user.subscriptionTier || 'free';
    if (tier === 'agency') tier = 'studio';

    const limit = PLAN_LIMITS[tier] ?? 3;

    res.json({
      tier,
      limits: {
        scans_per_month: limit,
        scripts_per_month: limit,
        batch: tier === 'studio',
        export: tier === 'studio',
      },
      usage: {
        scans: user.totalVideosAnalyzed || 0,
        scripts: user.totalScripts || 0
      }
    });
  } catch (err) {
    console.error('Plan check failed:', err);
    res.status(500).json({ error: 'Plan check failed' });
  }
});

router.post('/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const [existing] = await sql`SELECT id FROM users WHERE LOWER(email) = LOWER(${email})`;
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const [newUser] = await sql`
      INSERT INTO users (email, password, name, created_at)
      VALUES (${email}, ${hashedPassword}, ${name || null}, NOW())
      RETURNING id, email
    `;

    res.status(201).json({ message: 'User created', user: { id: newUser.id, email: newUser.email } });
  } catch (err) {
    console.error('Failed to create user:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

module.exports = router;
