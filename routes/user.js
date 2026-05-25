const express = require('express');
const bcrypt = require('bcryptjs');
const { sql } = require('../db/index');
const prisma = require('../db/prisma');
const { resolveInternalId } = require('../utils/userResolver');

const router = express.Router();

router.post('/auth/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const [existing] = await sql`SELECT * FROM users WHERE email = ${email}`;
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await sql`
      INSERT INTO users (email, password, name, created_at)
      VALUES (${email}, ${hashedPassword}, ${name || null}, ${new Date()})
      RETURNING id, email, name
    `;

    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (err) {

    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.get('/me', async (req, res) => {
  let userId = req.query.userId;
  const { email, name } = req.query;
  userId = await resolveInternalId(userId, { email, name });
  if (!userId) return res.status(404).json({ error: 'User not found' });

  try {
    if (userId === '00000000-0000-0000-0000-000000000000') {
      return res.json({
        id: userId,
        name: 'Elite Master Admin',
        email: 'admin@eixora.ai',
        plan_type: 'studio',
        subscription_tier: 'studio',
        is_admin: true,
        is_master_admin: true,
        credits_remaining: 999999,
        monthly_usage: { scans: 0, scripts: 0 }
      });
    }

    const [user] = await sql`
      SELECT 
        id, 
        name, 
        email, 
        image, 
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

    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    const [{ scriptCount }] = await sql`
      SELECT count(*)::int as "scriptCount" FROM scripts 
      WHERE user_id = ${userId} AND created_at > ${oneMonthAgo}
    `;

    const [{ scanCount }] = await sql`
      SELECT count(*)::int as "scanCount" FROM scan_events
      WHERE user_id = ${userId} AND created_at > ${oneMonthAgo}
    `;

    // ADMIN BYPASS: Always give owner accounts the top tier plan
    let effectiveTier = user.subscriptionTier;
    // Normalize legacy 'agency' tier to 'studio'
    if (effectiveTier === 'agency') effectiveTier = 'studio';
    const adminEmails = ['deamirclothingstores@gmail.com', 'hello@eixora.store', 'admin@eixora.ai'];
    const currentEmail = email || user.email;
    if (currentEmail && adminEmails.includes(currentEmail.toLowerCase())) {
        effectiveTier = 'studio';
    }

    res.json({
      ...user,
      plan_type: effectiveTier,
      subscription_tier: effectiveTier,
      credits_remaining: user.creditsRemaining,
      total_scripts: user.totalScripts,
      total_pins: user.totalPins,
      total_videos_analyzed: user.totalVideosAnalyzed,
      onboarding_completed: user.onboardingCompleted,
      brand_niche: user.brandNiche,
      primary_goal: user.primaryGoal,
      created_at: user.createdAt,
      monthly_usage: {
        scans: scanCount || 0,
        scripts: scriptCount
      }
    });
  } catch (err) {

    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/me', async (req, res) => {
  let { userId, name, onboarding_completed, brand_niche, primary_goal } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name !== undefined ? name : undefined,
        onboardingCompleted: onboarding_completed !== undefined ? onboarding_completed : undefined,
        brandNiche: brand_niche !== undefined ? brand_niche : undefined,
        primaryGoal: primary_goal !== undefined ? primary_goal : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        subscriptionTier: true,
        creditsRemaining: true,
        totalScripts: true,
        totalPins: true,
        onboardingCompleted: true,
        brandNiche: true,
        primaryGoal: true
      }
    });

    res.json({
      ...updatedUser,
      plan_type: updatedUser.subscriptionTier,
      subscription_tier: updatedUser.subscriptionTier,
      onboarding_completed: updatedUser.onboardingCompleted,
      brand_niche: updatedUser.brandNiche,
      primary_goal: updatedUser.primaryGoal
    });
  } catch (err) {

    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/plan-check', async (req, res) => {
  let userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  try {
    const [user] = await sql`SELECT subscription_tier, subscription_status FROM users WHERE id = ${userId}`;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tier = user.subscription_tier || 'free';
    const limits = {
      free: { scans_per_month: 3, scripts_per_month: 3, batch: false, export: false, team: false },
      creator: { scans_per_month: 30, scripts_per_month: 30, batch: false, export: false, team: false },
      studio: { scans_per_month: 250, scripts_per_month: 250, batch: true, export: true, team: true },
      agency: { scans_per_month: 250, scripts_per_month: 250, batch: true, export: true, team: true }, // Legacy
    };

    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    const [{ scanCount }] = await sql`
      SELECT count(*)::int as "scanCount" FROM scan_events 
      WHERE user_id = ${userId} AND created_at > ${oneMonthAgo}
    `;

    const [{ scriptCount }] = await sql`
      SELECT count(*)::int as "scriptCount" FROM scripts 
      WHERE user_id = ${userId} AND created_at > ${oneMonthAgo}
    `;

    res.json({
      tier,
      status: user.subscription_status || 'inactive',
      limits: limits[tier] || limits.free,
      usage: {
        scans: scanCount,
        scripts: scriptCount
      }
    });
  } catch (err) {

    res.status(500).json({ error: 'Plan check failed' });
  }
});

module.exports = router;
