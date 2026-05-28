const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { resolveInternalId } = require('../utils/userResolver');

const router = express.Router();

// Simple plan limits
const PLAN_LIMITS = { free: 3, creator: 30, studio: 250, agency: 250, founding: 30 };

router.get('/me', async (req, res) => {
  let userId = req.query.userId;
  const { email, name } = req.query;

  userId = await resolveInternalId(userId, { email, name });
  if (!userId) return res.status(404).json({ error: 'User not found' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        subscriptionTier: true,
        creditsRemaining: true,
        totalScripts: true,
        totalPins: true,
        totalVideosAnalyzed: true,
        onboardingCompleted: true,
        brandNiche: true,
        primaryGoal: true,
        createdAt: true,
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Normalize tier
    let tier = user.subscriptionTier || 'free';
    if (tier === 'agency') tier = 'studio';
    if (tier === 'founding') tier = 'creator';

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
      monthly_usage: {
        scans: user.totalVideosAnalyzed || 0,
        scripts: user.totalScripts || 0
      }
    });
  } catch (err) {
    console.error('[/me] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/me', async (req, res) => {
  let { userId, name, onboarding_completed, brand_niche, primary_goal, source } = req.body;
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
        source: source !== undefined ? source : undefined,
      },
      select: {
        id: true, name: true, email: true, image: true,
        subscriptionTier: true, creditsRemaining: true,
        totalScripts: true, totalPins: true,
        onboardingCompleted: true, brandNiche: true, primaryGoal: true, source: true
      }
    });

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
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/plan-check', async (req, res) => {
  let userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true, totalVideosAnalyzed: true, totalScripts: true }
    });

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
    res.status(500).json({ error: 'Plan check failed' });
  }
});

router.post('/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { email, password: hashedPassword, name: name || null }
    });

    res.status(201).json({ message: 'User created', user: { id: newUser.id, email: newUser.email } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

module.exports = router;
