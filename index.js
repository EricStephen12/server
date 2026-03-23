const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const multer = require('multer');
const { ApifyClient } = require('apify-client');
const { extractFrames } = require('./utils/frameExtractor');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');
const { transcribeAudio } = require('./utils/audioTranscriber');
const { sql, testConnection } = require('./db/index');
const authenticateClerk = require('./middleware/clerkAuth');
const adminRouter = require('./routes/admin');
const clerkWebhooks = require('./routes/webhooks');
const polarWebhooks = require('./routes/polar');
const checkoutRouter = require('./routes/checkout');

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware
// Standardize FRONTEND_URL for CORS
const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

app.use(cors({
  origin: function (origin, callback) {
    // 1. Allow local development
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }

    // 2. Allow configured Production URL
    if (origin === frontendUrl) {
      return callback(null, true);
    }

    // 3. Allow all Vercel domains (for preview branches)
    if (origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }

    // 4. Fallback/Allow list for known aliases
    const allowList = [
      'https://eixora.vercel.app',
      'https://client-phi-ivory.vercel.app'
    ];
    if (allowList.includes(origin)) {
      return callback(null, true);
    }

    console.warn(`🚨 [CORS] Blocked access from: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(cookieParser());

// Webhook & Payment Routes - MUST be before express.json() for raw body signatures
app.use('/api/webhooks/clerk', clerkWebhooks);
app.use('/api/webhooks/polar', polarWebhooks);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Neon Database Connection (Postgres)
// Connection is tested in app.listen below for cleaner startup sequence.

// Groq Connection
let groq;
try {
  if (process.env.GROQ_API_KEY) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
  } else {
    console.warn('WARNING: GROQ_API_KEY is missing in .env file');
  }
} catch (err) {
  console.warn('Groq initialization failed:', err.message);
}

// Health Check
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    message: 'Server is running.',
    groq_configured: !!groq,
    gemini_configured: false // Gemini is no longer used
  });
});

app.use('/api/checkout', checkoutRouter);

// Admin Routes
app.use('/api/admin', adminRouter);

// DIAGNOSTIC ENDPOINT — hit this URL in browser to see what's broken
app.get('/api/debug', async (req, res) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const axios = require('axios');
  const report = {};

  // 1. Env vars
  report.env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    APIFY_API_TOKEN: !!process.env.APIFY_API_TOKEN,
    PORT: process.env.PORT,
  };

  // 2. ffmpeg
  try {
    const ffmpegPath = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
    report.ffmpeg = { found: true, path: ffmpegPath, source: 'system' };
  } catch (_) {
    try {
      const ffmpegStatic = require('ffmpeg-static');
      if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        report.ffmpeg = { found: true, path: ffmpegStatic, source: 'ffmpeg-static' };
      } else {
        report.ffmpeg = { found: false, error: 'ffmpeg-static module found but binary missing' };
      }
    } catch (e2) {
      report.ffmpeg = { found: false, error: 'ffmpeg not found in PATH or ffmpeg-static' };
    }
  }

  // 3. /tmp writability
  try {
    const testFile = '/tmp/debug_test.txt';
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    report.tmp_writable = true;
  } catch (e) {
    report.tmp_writable = false;
    report.tmp_error = e.message;
  }

  // 4. tikwm API
  try {
    const tikwmRes = await axios.post('https://tikwm.com/api/',
      'url=https://www.tiktok.com/@tiktok/video/6584647400055855365&hd=1',
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    report.tikwm = { reachable: true, code: tikwmRes.data?.code, has_data: !!tikwmRes.data?.data };
  } catch (e) {
    report.tikwm = { reachable: false, error: e.message };
  }

  // 5. Groq API
  try {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    const testGroq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const models = await testGroq.models.list();
    report.groq = { reachable: true, model_count: models.data?.length };
  } catch (e) {
    report.groq = { reachable: false, error: e.message };
  }

  // 6. Neon Database
  try {
    const isHealthy = await testConnection();
    const countRes = await sql`SELECT count(*) FROM ads`;
    report.db = {
      reachable: isHealthy,
      ads_count: parseInt(countRes[0].count),
      provider: 'Neon'
    };
  } catch (e) {
    report.db = { reachable: false, error: e.message };
  }

  res.json({ status: 'debug_complete', report });
});

// AUTH REGISTRATION — creates user in Neon for CredentialsProvider
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  const bcrypt = require('bcryptjs');

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Check if user exists
    const [existing] = await sql`SELECT * FROM users WHERE email = ${email}`;
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [newUser] = await sql`
      INSERT INTO users (email, password, name, created_at)
      VALUES (${email}, ${hashedPassword}, ${name || null}, ${new Date()})
      RETURNING id, email, name
    `;

    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// GET CURRENT USER PROFILE
app.get('/api/me', authenticateClerk, async (req, res) => {
  try {
    const [user] = await sql`
      SELECT id, name, email, image, subscription_tier as plan_type, subscription_tier, credits_remaining, total_scripts, total_pins, total_videos_analyzed, created_at
      FROM users
      WHERE id = ${req.user.id}
    `;

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Fetch monthly usage
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    const [{ scanCount }] = await sql`
      SELECT count(*)::int as "scanCount" FROM lounge_sessions 
      WHERE user_id = ${req.user.id} AND updated_at > ${oneMonthAgo}
    `;

    const [{ scriptCount }] = await sql`
      SELECT count(*)::int as "scriptCount" FROM scripts 
      WHERE user_id = ${req.user.id} AND created_at > ${oneMonthAgo}
    `;

    res.json({
      ...user,
      monthly_usage: {
        scans: scanCount,
        scripts: scriptCount
      }
    });
  } catch (err) {
    console.error('Fetch profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// UPDATE CURRENT USER PROFILE
app.patch('/api/me', authenticateClerk, async (req, res) => {
  const { name } = req.body;
  try {
    const [updatedUser] = await sql`
      UPDATE users
      SET name = ${name || req.user.name}, updated_at = now()
      WHERE id = ${req.user.id}
      RETURNING id, name, email, image, subscription_tier, credits_remaining, total_scripts, total_pins
    `;

    res.json(updatedUser);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// STEP-BY-STEP PIPELINE TESTER — hit with ?url=YOUR_TIKTOK_URL
app.get('/api/test-tiktok', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'Pass ?url=TIKTOK_URL' });
  const axios = require('axios');
  const fs = require('fs');
  const ffmpeg = require('fluent-ffmpeg');
  const ffmpegStatic = require('ffmpeg-static');
  if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

  const result = { url: videoUrl, steps: {} };
  let videoDownloadUrl = null;
  const testVideoPath = '/tmp/test_video_' + Date.now() + '.mp4';

  // Step 1: tikwm
  try {
    const cleanUrl = videoUrl.split('?')[0];
    const tikwmRes = await axios.post('https://tikwm.com/api/',
      `url=${encodeURIComponent(cleanUrl)}&hd=1`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );
    const d = tikwmRes.data;
    videoDownloadUrl = d.data?.hdplay || d.data?.play || d.data?.wmplay;
    result.steps.tikwm = { code: d.code, msg: d.msg, resolved: !!videoDownloadUrl };
  } catch (e) {
    result.steps.tikwm = { error: e.message };
    return res.json(result);
  }

  // Step 2: actual download to /tmp
  try {
    const dlRes = await axios({
      method: 'get', url: videoDownloadUrl, responseType: 'stream', timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.tiktok.com/',
        'Origin': 'https://www.tiktok.com',
      }
    });
    const writer = fs.createWriteStream(testVideoPath);
    dlRes.data.pipe(writer);
    await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });
    const stat = fs.statSync(testVideoPath);
    result.steps.download = { file_size_mb: (stat.size / 1024 / 1024).toFixed(2), path: testVideoPath };
  } catch (e) {
    result.steps.download = { error: e.message };
    return res.json(result);
  }

  // Step 3: ffprobe
  try {
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(testVideoPath, (err, data) => err ? reject(err) : resolve(data));
    });
    result.steps.ffprobe = {
      duration: metadata.format?.duration,
      format: metadata.format?.format_name,
      streams: metadata.streams?.length
    };
  } catch (e) {
    result.steps.ffprobe = { error: e.message };
  } finally {
    if (fs.existsSync(testVideoPath)) fs.unlinkSync(testVideoPath);
  }

  res.json(result);
});



// Private Vault - Save analyzed video to user collection
app.post('/api/save-to-vault', async (req, res) => {
  const { userId, title, videoUrl, visualDna } = req.body;

  if (!userId || !videoUrl) {
    return res.status(400).json({ error: 'User ID and Video URL are required' });
  }

  try {
    const [data] = await sql`
      INSERT INTO ads (title, video_url, visual_dna, is_verified)
      VALUES (${title || 'Saved Ad'}, ${videoUrl}, ${JSON.stringify(visualDna)}, true)
      RETURNING *
    `;

    // Increment total_pins
    await sql`UPDATE users SET total_pins = total_pins + 1 WHERE id = ${userId}`;

    res.json({ success: true, ad: data });
  } catch (error) {
    console.error('Save to vault error:', error);
    res.status(500).json({ error: 'Failed to save to vault' });
  }
});

// STANDALONE VIDEO ANALYSIS ENDPOINT
// Private Vault - Fetch user's saved ads
app.get('/api/user-ads', async (req, res) => {
  const { userId, search, niche } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    let ads;
    if (search) {
      ads = await sql`SELECT * FROM user_ads WHERE user_id = ${userId} AND (title ILIKE ${`%${search}%`} OR niche ILIKE ${`%${search}%`}) ORDER BY created_at DESC`;
    } else if (niche && niche !== 'all') {
      ads = await sql`SELECT * FROM user_ads WHERE user_id = ${userId} AND niche = ${niche} ORDER BY created_at DESC`;
    } else {
      ads = await sql`SELECT * FROM user_ads WHERE user_id = ${userId} ORDER BY created_at DESC`;
    }

    const formattedAds = ads.map(ad => ({
      id: ad.id,
      niche: ad.niche || 'custom',
      thumbnail: ad.thumbnail_url || 'https://via.placeholder.com/300x500?text=Vault+Ad',
      videoUrl: ad.video_url,
      title: ad.title,
      engagement: {
        views: 'N/A',
        likes: 'N/A',
        comments: '0'
      },
      date: new Date(ad.created_at).toISOString().split('T')[0],
      visual_dna: ad.visual_dna
    }));

    res.json(formattedAds);
  } catch (error) {
    console.error('Error fetching user ads:', error);
    res.status(500).json({ error: 'Failed to fetch user ads' });
  }
});

// Helper to check monthly limits for free users
async function checkLimits(userId, type) {
  try {
    const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
    const tier = user?.subscription_tier || 'free';

    if (tier !== 'free') return { allowed: true };

    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    if (type === 'scan') {
      const [{ count }] = await sql`
        SELECT count(*)::int FROM lounge_sessions 
        WHERE user_id = ${userId} AND updated_at > ${oneMonthAgo}
      `;
      return { allowed: count < 3, count, limit: 3 };
    }

    if (type === 'script') {
      const [{ count }] = await sql`
        SELECT count(*)::int FROM scripts 
        WHERE user_id = ${userId} AND created_at > ${oneMonthAgo}
      `;
      return { allowed: count < 3, count, limit: 3 };
    }

    return { allowed: true };
  } catch (err) {
    console.error('Limit check error:', err);
    return { allowed: true }; // Allow on error to avoid blocking users
  }
}

// STANDALONE VIDEO ANALYSIS ENDPOINT (URL Based)
app.post('/api/analyze-video-url', async (req, res) => {
  const { videoUrl, userId } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Groq API not configured' });
  }

  // Plan Gating: Check monthly scan limits for free users
  if (userId) {
    const limit = await checkLimits(userId, 'scan');
    if (!limit.allowed) {
      return res.status(403).json({
        error: 'Monthly Scan Limit Reached',
        details: `Free users are limited to 3 scans per month. You have used ${limit.count}/${limit.limit}. Please upgrade to lock in the Founding Rate!`,
        upgradeRequired: true
      });
    }
  }

  try {
    console.log('🎥 Locating Viral DNA from URL...');
    const { frames, audioPath } = await extractFrames(videoUrl);

    if (!frames || frames.length === 0) {
      throw new Error('No frames could be extracted from this URL.');
    }

    // Transcription in parallel or sequence
    let transcript = "";
    if (audioPath) {
      try {
        transcript = await transcribeAudio(audioPath);
        console.log('🎙️ Transcript Extracted:', transcript.substring(0, 50) + '...');
      } catch (err) {
        console.warn('⚠️ Transcription failed, proceeding with vision only:', err.message);
      }
    }

    console.log('🧠 Analyzing Multi-Modal Masterclass Psychology...');
    const analysis = await analyzeVideoFrames(frames, `Analysis of: ${videoUrl}`, transcript);

    // Fuse transcript into analysis for the chat context
    analysis.transcript = transcript;

    console.log('✅ Masterclass DNA Extraction Complete');

    // Increment total_videos_analyzed
    if (userId) {
      try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${userId}`;
      } catch (err) {
        console.warn('Failed to increment total_videos_analyzed:', err.message);
      }
    }

    res.json({
      success: true,
      analysis,
      framesAnalyzed: frames.length,
      hasAudio: !!transcript
    });

  } catch (error) {
    console.error('Video URL analysis error:', error);
    res.status(500).json({
      error: 'Failed to extract DNA from URL',
      details: error.message
    });
  }
});

// ============================================
// BATCH URL PROCESSING (Agency Only)
// ============================================
app.post('/api/batch-analyze', authenticateClerk, async (req, res) => {
  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of URLs' });
  }

  if (urls.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 URLs per batch' });
  }

  // Plan Gating: Agency Only
  const tier = req.user.subscription_tier || 'free';
  if (tier !== 'agency') {
    return res.status(403).json({
      error: 'Agency Access Required',
      details: 'Batch Analysis is exclusive to the Agency Plan. Upgrade to unlock bulk DNA extraction.'
    });
  }

  console.log(`📦 Batch processing ${urls.length} URLs for user ${req.user.id}`);

  const results = [];
  // Process in chunks or parallel with limit to avoid overwhelming CPU/Disk
  const concurrencyLimit = 3;
  const processVideo = async (videoUrl, index) => {
    const url = videoUrl.trim();
    if (!url) return { url, success: false, error: 'Empty URL' };

    try {
      console.log(`📦 [${index + 1}/${urls.length}] Starting: ${url.substring(0, 60)}...`);
      const { frames, audioPath } = await extractFrames(url);

      if (!frames || frames.length === 0) {
        return { url, success: false, error: 'No frames extracted' };
      }

      let transcript = "";
      if (audioPath) {
        try {
          transcript = await transcribeAudio(audioPath);
        } catch (err) {
          console.warn(`⚠️ Transcription failed for ${url}:`, err.message);
        }
      }

      const analysis = await analyzeVideoFrames(frames, `Analysis of: ${url}`, transcript);
      analysis.transcript = transcript;

      // Increment stats
      try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${req.user.id}`;
      } catch (err) {
        console.warn('Failed to increment stat:', err.message);
      }

      console.log(`✅ [${index + 1}/${urls.length}] Finished: ${url.substring(0, 60)}...`);
      return {
        url,
        success: true,
        analysis,
        framesAnalyzed: frames.length,
        hasAudio: !!transcript
      };
    } catch (error) {
      console.error(`❌ [${index + 1}/${urls.length}] Failed: ${url}:`, error.message);
      return { url, success: false, error: error.message };
    }
  };

  // Run in chunks
  for (let i = 0; i < urls.length; i += concurrencyLimit) {
    const chunk = urls.slice(i, i + concurrencyLimit);
    const chunkResults = await Promise.all(chunk.map((url, j) => processVideo(url, i + j)));
    results.push(...chunkResults);
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`📦 Batch complete: ${successCount}/${urls.length} successful`);

  res.json({
    success: true,
    total: urls.length,
    completed: successCount,
    failed: urls.length - successCount,
    results
  });
});

// ============================================
// EXPORT DNA REPORT (Agency Only)
// ============================================
app.post('/api/export-report', authenticateClerk, async (req, res) => {
  const { analysis, videoUrl } = req.body;

  // Plan Gating: Agency Only
  const tier = req.user.subscription_tier || 'free';
  if (tier !== 'agency') {
    return res.status(403).json({
      error: 'Agency Access Required',
      details: 'Report Exporting is an Agency plan feature. Upgrade to unlock full DNA dossiers.'
    });
  }

  if (!analysis) {
    return res.status(400).json({ error: 'No analysis data provided' });
  }

  try {
    const report = [
      '═══════════════════════════════════════════',
      '         EIXORA — VIRAL DNA REPORT         ',
      '═══════════════════════════════════════════',
      '',
      `Video: ${videoUrl || 'N/A'}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      '───────────────────────────────────────────',
      'PERFORMANCE METRICS',
      '───────────────────────────────────────────',
      `Hook Power:        ${analysis.metrics?.hook_power || 'N/A'}/10`,
      `Retention Score:   ${analysis.metrics?.retention_score || 'N/A'}/10`,
      `CTA Strength:      ${analysis.metrics?.conversion_trigger || 'N/A'}/10`,
      '',
      '───────────────────────────────────────────',
      'THE BIG IDEA',
      '───────────────────────────────────────────',
      analysis.big_idea || 'N/A',
      '',
      '───────────────────────────────────────────',
      'HOOK ANALYSIS',
      '───────────────────────────────────────────',
      analysis.hook_analysis?.critique || 'N/A',
      '',
      '───────────────────────────────────────────',
      'TRANSCRIPT',
      '───────────────────────────────────────────',
      analysis.transcript || 'No transcript available',
      '',
      '═══════════════════════════════════════════',
      '         Generated by EIXORA by EXRICX     ',
      '═══════════════════════════════════════════',
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="eixora-dna-report-${Date.now()}.txt"`);
    res.send(report);
  } catch (err) {
    console.error('Export report error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ============================================
// PLAN CHECK ENDPOINT
// ============================================
app.get('/api/plan-check', authenticateClerk, async (req, res) => {
  try {
    const [user] = await sql`SELECT subscription_tier, subscription_status FROM users WHERE id = ${req.user.id}`;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tier = user.subscription_tier || 'free';
    const limits = {
      free: { scans_per_month: 3, scripts_per_month: 3, batch: false, export: false },
      founding: { scans_per_month: -1, scripts_per_month: -1, batch: false, export: false },
      agency: { scans_per_month: -1, scripts_per_month: -1, batch: true, export: true },
    };

    // Fetch current monthly usage
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    const [{ scanCount }] = await sql`
      SELECT count(*)::int as "scanCount" FROM lounge_sessions 
      WHERE user_id = ${req.user.id} AND updated_at > ${oneMonthAgo}
    `;

    const [{ scriptCount }] = await sql`
      SELECT count(*)::int as "scriptCount" FROM scripts 
      WHERE user_id = ${req.user.id} AND created_at > ${oneMonthAgo}
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
    console.error('Plan check error:', err);
    res.status(500).json({ error: 'Plan check failed' });
  }
});

app.post('/api/analyze-video', authenticateClerk, upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Groq API not configured' });
  }

  const userId = req.user.id;

  // Plan Gating: Check monthly scan limits for free users
  if (userId) {
    const limit = await checkLimits(userId, 'scan');
    if (!limit.allowed) {
      return res.status(403).json({
        error: 'Monthly Scan Limit Reached',
        details: `Free users are limited to 3 scans per month. You have used ${limit.count}/${limit.limit}. Please upgrade to lock in the Founding Rate!`,
        upgradeRequired: true
      });
    }
  }

  try {
    console.log('🎥 Extracting DNA from draft...');
    const { frames, audioPath } = await extractFrames(req.file.path);

    if (!frames || frames.length === 0) {
      throw new Error('No frames could be extracted from this video.');
    }

    // Transcription
    let transcript = "";
    if (audioPath) {
      try {
        transcript = await transcribeAudio(audioPath);
        console.log('🎙️ Transcript Extracted:', transcript.substring(0, 50) + '...');
      } catch (err) {
        console.warn('⚠️ Transcription failed:', err.message);
      }
    }

    console.log('🧠 Auditing Multi-Modal Mastery...');
    const analysis = await analyzeVideoFrames(frames, 'Uploaded Draft Analysis', transcript);

    // Increment total_videos_analyzed
    if (userId) {
      try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${userId}`;
      } catch (err) {
        console.warn('Failed to increment total_videos_analyzed:', err.message);
      }
    }

    res.json({
      success: true,
      analysis,
      framesAnalyzed: frames.length,
      hasAudio: !!transcript
    });

  } catch (error) {
    console.error('Video analysis error:', error);
    res.status(500).json({
      error: 'Video audit failed',
      details: error.message
    });
  }
});

app.post('/api/generate-script', authenticateClerk, async (req, res) => {
  const { productName, description, adId, answers, privateDna } = req.body;
  const userId = req.user.id;

  if (!productName || !description) {
    return res.status(400).json({ error: 'Product name and description are required' });
  }

  if (!groq) {
    return res.status(503).json({ error: 'AI service not available (API Key Missing)' });
  }

  // Plan Gating
  if (userId) {
    const limit = await checkLimits(userId, 'script');
    if (!limit.allowed) {
      return res.status(403).json({
        error: 'Monthly Director Brief Limit Reached',
        details: `Free users are limited to 3 Director Briefs per month. You have used ${limit.count}/${limit.limit}. Please upgrade to lock in the Founding Rate!`,
        upgradeRequired: true
      });
    }
  }

  try {
    let contextPrompt = "";
    let visualAnalysis = null;

    // If adId is provided, fetch the winning ad and use its DNA
    if (adId) {
      const [adData] = await sql`SELECT * FROM ads WHERE id = ${adId}`;

      if (adData) {
        // PRIORITY 1: Use pre-processed Visual DNA (Instant & 100% Reliable)
        if (adData.visual_dna) {
          console.log(`🧠 Using pre-processed DNA for ad: ${adData.title}`);
          const dna = adData.visual_dna;
          contextPrompt = `
            WINNING AD VISUAL DNA (REPLICATE THIS EXACT STRUCTURE):
            
            **Hook (0-3s):**
            ${dna.hook_analysis.visual_description}
            Camera Work: ${dna.hook_analysis.camera_work}
            Subject Action: ${dna.hook_analysis.subject_action}
            Energy: ${dna.hook_analysis.energy_level}
            ${dna.hook_analysis.text_overlays ? `Text Overlays: ${dna.hook_analysis.text_overlays}` : ''}
            
            **Problem Scene (3-8s):**
            ${dna.problem_scene.visual_approach}
            Transitions: ${dna.problem_scene.transitions}
            Emotional Cues: ${dna.problem_scene.emotional_cues}
            
            **Solution Scene (8-15s):**
            Product Demo Style: ${dna.solution_scene.product_demo_style}
            Visual Proof: ${dna.solution_scene.visual_proof}
            Pacing: ${dna.solution_scene.pacing}
            
            **CTA Scene (15s+):**
            ${dna.cta_scene.closing_visual}
            CTA Presentation: ${dna.cta_scene.cta_presentation}
            
            **Overall Style:**
            Lighting: ${dna.overall_style.lighting}
            Color Palette: ${dna.overall_style.color_palette}
            Editing Pace: ${dna.overall_style.editing_pace}
            
            **ACTIONABLE DIRECTIONS:**
            ${dna.actionable_directions ? dna.actionable_directions.map((dir, i) => `${i + 1}. ${dir}`).join('\n') : "Copy the visual flow exactly."}
            
            CRITICAL INSTRUCTION: 
            Copy the EXACT visual structure, camera work, and pacing from the DNA above.
            Adapt it for "${productName}" while maintaining the same winning energy.
            Your script must be SPECIFIC and ACTIONABLE.
            `;
        }
        // PRIORITY 2: Fallback to real-time analysis (Slow & potentially unreliable)
        else if (adData.video_url && process.env.GEMINI_API_KEY) {
          try {
            console.log(`🎥 Falling back to real-time analysis for: ${adData.title}`);
            const frames = await extractFrames(adData.video_url);
            visualAnalysis = await analyzeVideoFrames(frames, `${productName} - ${description}`);
            console.log('✅ Video analysis complete');

            // Build context from visual analysis
            contextPrompt = `
            WINNING AD VISUAL ANALYSIS (REPLICATE THIS EXACT STRUCTURE):
            
            **Hook (0-3s):**
            ${visualAnalysis.hook_analysis.visual_description}
            Camera Work: ${visualAnalysis.hook_analysis.camera_work}
            Subject Action: ${visualAnalysis.hook_analysis.subject_action}
            Energy: ${visualAnalysis.hook_analysis.energy_level}
            ${visualAnalysis.hook_analysis.text_overlays ? `Text Overlays: ${visualAnalysis.hook_analysis.text_overlays}` : ''}
            
            **Problem Scene (3-8s):**
            ${visualAnalysis.problem_scene.visual_approach}
            Transitions: ${visualAnalysis.problem_scene.transitions}
            Emotional Cues: ${visualAnalysis.problem_scene.emotional_cues}
            
            **Solution Scene (8-15s):**
            Product Demo Style: ${visualAnalysis.solution_scene.product_demo_style}
            Visual Proof: ${visualAnalysis.solution_scene.visual_proof}
            Pacing: ${visualAnalysis.solution_scene.pacing}
            
            **CTA Scene (15s+):**
            ${visualAnalysis.cta_scene.closing_visual}
            CTA Presentation: ${visualAnalysis.cta_cta_presentation}
            
            **Overall Style:**
            Lighting: ${visualAnalysis.overall_style.lighting}
            Color Palette: ${visualAnalysis.overall_style.color_palette}
            Editing Pace: ${visualAnalysis.overall_style.editing_pace}
            
            **ACTIONABLE DIRECTIONS:**
            ${visualAnalysis.actionable_directions.map((dir, i) => `${i + 1}. ${dir}`).join('\n')}
            
            STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
            ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

            CRITICAL INSTRUCTION: 
            Copy the EXACT visual structure, camera work, and pacing from the analysis above.
            Adapt it for "${productName}" while maintaining the same energy, timing, and visual approach.
            Your script must be SPECIFIC and ACTIONABLE - the user should know exactly what to film.
            `;
          } catch (visionError) {
            console.error('Video analysis failed, falling back to text analysis:', visionError.message);
            // Fall back to basic text analysis if video analysis fails
            if (adData.analysis) {
              contextPrompt = `
              WINNING AD STRUCTURE (REPLICATE THIS):
              - Original Hook Logic: "${adData.analysis.hook}"
              - Original Problem Logic: "${adData.analysis.problem}"
              - Original Solution Logic: "${adData.analysis.solution}"
              
              STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
              ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

              INSTRUCTION: Reuse the same psychological pattern and pacing as the Winning Ad "${adData.title}", but rewrite it specifically for the user's product (${productName}).
              IMPORTANT: Incorporate the Strategic Interview Context above to ensure the script matches the user's specific angle/preferences.
              `;
            }
          }
        } else if (adData.analysis) {
          // No video URL or Gemini not configured, use basic analysis
          contextPrompt = `
          WINNING AD STRUCTURE (REPLICATE THIS):
          - Original Hook Logic: "${adData.analysis.hook}"
          - Original Problem Logic: "${adData.analysis.problem}"
          - Original Solution Logic: "${adData.analysis.solution}"
          
          STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
          ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

          INSTRUCTION: Reuse the same psychological pattern and pacing as the Winning Ad "${adData.title}", but rewrite it specifically for the user's product (${productName}).
          IMPORTANT: Incorporate the Strategic Interview Context above to ensure the script matches the user's specific angle/preferences.
          `;
        }
      }
    } else if (privateDna) {
      contextPrompt = `
            PRIVATE VIDEO DNA STRUCTURE (REPLICATE THIS):
            - Original Hook Logic: "${privateDna.hook}"
            - Original Problem Logic: "${privateDna.problem}"
            - Original Solution Logic: "${privateDna.solution}"
            
            STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
            ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

            INSTRUCTION: Reuse the same psychological pattern and pacing from the analyzed video, but rewrite it specifically for the user's product (${productName}).
            IMPORTANT: Incorporate the Strategic Interview Context above to ensure the script matches the user's specific angle/preferences.
            `;
    }

    const prompt = `
        ${contextPrompt}

        User Product: ${productName}
        Description: ${description}

        INSPIRATION MODE: REPRODUCE THE MAGIC.
        The user chose this source ad because it is a "Viral Winner". 
        Your job is to deconstruct why it won and RECREATE that same winning energy for the new product.

        - **Psychological Mirroring**: If the original used "Relatability" as a hook, find a Relatable hook for '${productName}'. 
        - **Visual Pacing**: Use the exact same storytelling arc (e.g. 2s Hook -> 5s Problem -> 10s Solution).
        - **Creative Parity**: The goal is to make a new ad that feels like it was made by the same Artistic Director as the original.

        Generate an Agency-Grade Viral Production Guide.
        Output JSON only: { 
            "summary": {
                "hook": "...", 
                "problem": "...", 
                "solution": "...", 
                "cta": "..."
            },
            "shot_list": [
                { 
                    "time": "...", 
                    "shot": "...", 
                    "visual": "Direct instructions to replicate the exact movement/lighting/energy of the source ad's corresponding scene.", 
                    "audio": "...", 
                    "text_overlay": "..." 
                }
            ],
            "aesthetic_guide": {
                "lighting": "Mimic source ad cinematography",
                "music_vibe": "Mimic source ad emotional frequency",
                "color_palette": "Mimic source ad visual mood"
            }
        }

        IMPORTANT: Replicate the EXACT visual pacing and transition style of the winning ad "${adId}". Preserve the SOUL of the creative while changing the product.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    const fullGuide = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const scriptContent = fullGuide.summary || fullGuide; // Backward compatibility for DB save

    // Save to Supabase if connected
    if (sql) {
      try {
        await sql`
          INSERT INTO scripts (user_id, product_name, description, script_content, created_at)
          VALUES (${req.user.id}, ${productName}, ${description}, ${JSON.stringify(scriptContent)}, ${new Date()})
        `;
      } catch (dbErr) {
        console.error('Failed to save to DB:', dbErr);
      }
    }

    // Increment total_scripts in profiles
    if (sql && req.user.id) {
      try {
        await sql`
          UPDATE users 
          SET total_scripts = total_scripts + 1
          WHERE id = ${req.user.id}
        `;
      } catch (statErr) {
        console.error('Failed to increment scripts stat:', statErr);
      }
    }

    res.json(fullGuide);

  } catch (error) {
    console.error('Groq Error:', error);
    res.status(500).json({ error: 'Failed to generate script', details: error.message });
  }
});

// Helper function to format numbers (e.g., 12345 -> 12.3K)
const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};

// Endpoint to fetch ads
app.get('/api/ads', async (req, res) => {
  const { niche, search, verifiedOnly } = req.query;

  try {
    let ads;
    let query = `SELECT * FROM ads`;
    const params = [];
    const conditions = [];

    if (verifiedOnly === 'true') {
      conditions.push(`is_verified = TRUE`);
    }

    if (search) {
      conditions.push(`(title ILIKE $${params.length + 1} OR niche ILIKE $${params.length + 2})`);
      params.push(`%${search}%`, `%${search}%`);
    } else if (niche && niche !== 'all') {
      conditions.push(`niche = $${params.length + 1}`);
      params.push(niche);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY created_at DESC`;

    ads = await sql.unsafe(query, params);

    const formattedAds = ads.map(ad => ({
      id: ad.id,
      niche: ad.niche,
      thumbnail: ad.thumbnail_url,
      videoUrl: ad.video_url,
      title: ad.title,
      engagement: {
        views: formatNumber(ad.views_count || 0),
        likes: formatNumber(ad.likes_count || 0),
        comments: '0'
      },
      date: new Date(ad.created_at).toISOString().split('T')[0]
    }));

    res.json(formattedAds);
  } catch (error) {
    console.error('Error fetching ads:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

app.post('/api/script-strategy-questions', async (req, res) => {
  const { adId, productName, description, privateDna } = req.body;

  if (!adId && !privateDna) return res.status(400).json({ error: 'Ad ID or Private DNA is required' });

  try {
    let adData = { title: "Private Analysis", niche: "custom" };
    let visualContext = "";

    if (adId) {
      const [data] = await sql`SELECT * FROM ads WHERE id = ${adId}`;
      if (data) adData = data;
      console.log(`🧠 Remixing Ad Library Video: ${adData.title}`);

      if (adData.analysis && adData.analysis.hook) {
        visualContext = `
          VISUAL ANALYSIS (FROM PREVIOUS SCAN):
          - Hook: ${adData.analysis.hook}
          - Problem: ${adData.analysis.problem}
          - Solution: ${adData.analysis.solution}
        `;
      } else {
        visualContext = `
            AD CONTEXT:
            - Title: ${adData.title}
            - Niche: ${adData.niche}
        `;
      }
    } else if (privateDna) {
      console.log(`🧠 Remixing Private Video. DNA niche: ${privateDna.niche}`);
      visualContext = `
            PRIVATE VIDEO DNA (PREVIOUSLY ANALYZED):
            - Critique Hook: ${privateDna.hook}
            - Critique Problem/Pacing: ${privateDna.problem}
            - Critique Solution/CTA: ${privateDna.solution}
        `;
    }

    const prompt = `
      You are an Elite Viral Direct-Response Expert. 
      We are analyzing a high-performing ad: "${adData.title}".
      ${visualContext}
      
      The Objective: Guide the user to "Remix" this winner for their product: "${productName}".
      
      Generate 3 strategic internal-monologue style questions that extract the "Secrets" needed to bridge the original ad's psychology to this new product.
      Example: "The original ad relied on a 'messy room' relatable start. Do you have a relatable messy or stressful environment we can use, or should we go with a 'clean/minimalist' aesthetic for your brand?"

      Return JSON: { 
        "questions": ["q1", "q2", "q3"],
        "viral_blueprint": "Concise summary of why the original ad won (pacing, hook style, psychological trigger)",
        "analysis_logs": [
          "Deconstructing hook chemistry...",
          "Mapping emotional frequency...",
          "Extracting visual retention triggers...",
          "Syncing with ${adData.niche} viral trends..."
        ]
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    res.json(JSON.parse(completion.choices[0]?.message?.content || '{"questions": [], "analysis_logs": []}'));
  } catch (error) {
    console.error('Questions error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});


// Creative Director Chat Loop
app.post('/api/creative-director-chat', async (req, res) => {
  const { messages, dna, isRoastMode } = req.body;

  if (!groq) return res.status(503).json({ error: 'AI service not available' });

  try {
    const isIntro = !messages || messages.length === 0;

    const systemPrompt = `You are an Elite Creative Director & Growth Partner. 
    Your foundations are David Ogilvy (The Big Idea) and Eugene Schwartz (Level of Awareness).
    You have just PERSONALLY deconstructed the video frames and analyzed the psychological DNA. 
    We are in a private "Lounge Session." You aren't an AI; you're a mentor who has built 8-figure brands using these exact methods.
    
    ${isRoastMode ? 'YOUR PERSONA: ROAST MODE. Be direct, ruthless, and bored of excuses. No sugar-coating.' : 'YOUR PERSONA: Sophisticated Growth Partner. Direct, high-stakes, and elite.'}

    THE DECONSTRUCTED DNA (I just watched this and found):
    - **Niche**: ${dna.niche || 'General'}
    - **Level of Awareness**: ${dna.awareness_level || 'Unknown'}
    - **The Big Idea**: "${dna.big_idea || 'Not identified'}"
    - **The Secret Sauce**: "${dna.the_secret_sauce || 'Not identified'}"
    - **Vibe & Style**: ${dna.vibe_assessment?.style || 'N/A'} (Arc: ${dna.vibe_assessment?.emotional_arc || 'N/A'})
    - **Visual Hook**: ${dna.hook_analysis?.critique || 'No visual hook data'}
    - **Full Spoken Transcript**: "${dna.transcript || 'No transcript data'}"
    - **Pacing & Retention**: ${dna.pacing_analysis?.critique || 'Standard pacing'}
    - **CTA Mastery**: ${dna.cta_analysis?.critique || 'N/A'}
    - **Psychological Trigger**: ${dna.psychology_breakdown?.trigger || 'General curiosity'}
    - **Psychology Explained**: ${dna.psychology_breakdown?.explanation || 'N/A'}
    - **Actionable Directions**: ${dna.actionable_directions ? dna.actionable_directions.join(', ') : 'Maintain high energy'}
    
    PERFORMANCE SCORES:
    - **Hook Power**: ${dna.metrics?.hook_power || 'N/A'}/10
    - **Retention Strength**: ${dna.metrics?.retention_score || 'N/A'}/10
    - **Conversion Ability (CTA)**: ${dna.metrics?.conversion_trigger || 'N/A'}/10

    VIRAL CHECKLIST:
    ${dna.viral_checklist ? dna.viral_checklist.map(item => `- [${item.passed ? 'x' : ' '}] ${item.label}`).join('\n    ') : '- No checklist data available'}
    
    THE DIRECTOR'S RULEBOOK:
    1. **NO GENERIC ADVICE**: Do not use generic words like "authenticity" or "engagement" unless they are tied to a specific frame or quote from the data above.
    2. **CITE THE DNA**: In your memo, reference specific elements from 'THE DECONSTRUCTED DNA' (e.g., "The big idea of [Big Idea] is why this works...").
    3. **Structural Arbitrage**: Your job is to treat the analyzed video as a "Psychological Blueprint." Facilitate "Cross-Niche" transfer.
    4. **The Anchor Protocol**: In the intro, you MUST ask for their "Product Anchor" (what they are selling).
    
    ${isIntro ? `
    INSTRUCTION: Opening message. Deliver a "DIRECTOR'S STRATEGIC MEMO":
    
    1. **The Honest Verdict**: A 1-sentence sharp, brutally honest assessment of the video's potential. If the scores are high, tell them why it's a winner. If they are low, tell them exactly where it fails (e.g., "This hook is weak," "The CTA is a joke"). Use the PERFORMANCE SCORES as your guide.
    2. **The Stealable Pattern**: Even if the video is bad, find the ONE psychological trigger or pattern that was *attempted* correctly, or the one thing worth stealing.
    3. **The Bridge**: Briefly explain how this pattern (or a fix for it) applies to this ${dna.niche || 'specific'} niche. Be expert, not nice.
    4. **The Anchor Request**: End with: "I've deconstructed the blueprint. Give me your **Product Anchor** (what are you selling?)—and tell me if you want to stay in this niche or 'Arbitrage' this hook to something completely different."
    ` : 'Chat with them like a partner. Act as their "Structural Arbitrage" expert. Bridge the analyzed DNA to whatever product they mention. If the video sucked, keep reminding them why we are fixing it.'}
    `;

    let completion;
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`💬 Generating script(attempt ${attempt} / ${MAX_RETRIES})...`);
        completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            ...(messages || [])
          ],
          model: "llama-3.3-70b-versatile",
          temperature: 0.7,
        }, { timeout: 60000 });
        break; // Success — exit retry loop
      } catch (err) {
        const isNetworkError = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(err.cause?.code);
        console.warn(`⚠️ Chat attempt ${attempt} failed: ${err.message}`);
        if (attempt < MAX_RETRIES && isNetworkError) {
          console.log(`🔄 Retrying in 2s...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }

    res.json({ message: completion.choices[0]?.message?.content });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// Session Management Endpoints
app.post('/api/save-lounge-session', authenticateClerk, async (req, res) => {
  const { sessionId, videoUrl, dna, messages, title } = req.body;
  const userId = req.user.id; // Corrected to use authenticated user ID

  const msgCount = Array.isArray(messages) ? messages.length : 0;
  console.log(`💾 Persisting: User ${userId} | Session ${sessionId || 'NEW'} | Messages: ${msgCount}`);

  try {
    let result;
    if (sessionId && sessionId !== 'null' && sessionId !== 'undefined') {
      // Update existing session
      const [data] = await sql`
        UPDATE lounge_sessions 
        SET messages = ${messages}, updated_at = ${new Date()}
        WHERE id = ${sessionId} AND user_id = ${userId}
        RETURNING *
      `;
      result = data;
      if (result) {
        console.log(`✅ Session Updated: ${result.id} (${msgCount} msgs)`);
      } else {
        console.warn(`⚠️ Session ID ${sessionId} not found for update. Reverting to Insert.`);
      }
    }

    if (!result) {
      // Create new session
      const cleanTitle = title || `Analysis: ${videoUrl ? videoUrl.substring(0, 30) : 'Video'}...`;
      const [data] = await sql`
        INSERT INTO lounge_sessions(user_id, title, video_url, dna, messages, created_at, updated_at)
        VALUES(${userId}, ${cleanTitle}, ${videoUrl}, ${dna}, ${messages}, ${new Date()}, ${new Date()})
        RETURNING *
      `;
      result = data;
      console.log(`✅ New Session Created: ${result.id}`);
    }
    res.json(result);
  } catch (error) {
    console.error('❌ Save session error:', error);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

app.get('/api/user-sessions', authenticateClerk, async (req, res) => {
  const userId = req.user.id; // Corrected to use authenticated user

  console.log(`🔍 User Requesting History: ${userId}`);

  try {
    const data = await sql`
      SELECT id, title, video_url, updated_at as created_at 
      FROM lounge_sessions 
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 20
    `;
    console.log(`✅ Returned ${data.length} sessions for ${userId}`);
    res.json(data);
  } catch (error) {
    console.error('❌ Fetch sessions error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/lounge-session/:id', async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const [session] = await sql`SELECT * FROM lounge_sessions WHERE id = ${sessionId}`;

    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    console.error('Fetch session error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

app.post('/api/generate-final-script', async (req, res) => {
  const { messages, dna, userId } = req.body;

  if (!groq) return res.status(503).json({ error: 'AI service not available' });

  try {
    const finalPrompt = `AS THE ELITE CREATIVE DIRECTOR, SYNTHESIZE THIS MASTERMIND SESSION INTO A PRODUCTION GUIDE.
    
    ORIGINAL DNA:
  - Awareness Level: ${dna.awareness_level}
- Big Idea: ${dna.big_idea}
- Critique Hook: ${dna.hook_analysis.critique}
    
    CHAT CONTEXT(THE USER PREFERENCES):
  ${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
    
    INSTRUCTION:
  - Create an Agency - Grade Viral Production Guide.
    - Replicate the psychological energy of the original DNA but adapt for the new product using the chat context.
    - The script must be high - AOV, high - RECOUP focused.
    
    Output JSON only:
{
  "title": "Viral Script Name",
    "concept": "Brief concept summary",
      "awareness_level": "${dna.awareness_level}",
        "big_idea": "Synthesis of the chat + DNA",
          "shot_list": [
            { "time": "0-3s", "visual": "...", "audio": "...", "overlay": "..." },
            { "time": "3-8s", "visual": "...", "audio": "...", "overlay": "..." },
            { "time": "8-15s", "visual": "...", "audio": "...", "overlay": "..." },
            { "time": "15s+", "visual": "...", "audio": "...", "overlay": "..." }
          ]
} `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: finalPrompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    }, { timeout: 60000 });

    const script = JSON.parse(completion.choices[0]?.message?.content || '{}');

    // Save to Vault
    if (sql && userId) {
      // 1. Save Script
      const [newScript] = await sql`
        INSERT INTO scripts(user_id, title, script_content)
VALUES(${userId}, ${script.title}, ${JSON.stringify(script)})
RETURNING *
  `;

      // 2. Increment stats
      await sql`
        UPDATE users
        SET total_scripts = total_scripts + 1
        WHERE id = ${userId}
`;
    }

    res.json(script);
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================
// COMPETITOR SPY (Founding+ Only)
// ============================================
app.post('/api/competitor-spy', authenticateClerk, async (req, res) => {
  const { profileUrl } = req.body;

  if (!profileUrl) {
    return res.status(400).json({ error: 'TikTok profile URL or username is required' });
  }

  // Plan Gating: Founding or Agency
  const tier = req.user.subscription_tier || 'free';
  if (tier === 'free') {
    return res.status(403).json({
      error: 'Spy Access Restricted',
      details: 'Competitor Spying requires a Founding or Agency plan. Upgrade today to monitor rivals.'
    });
  }

  if (!process.env.APIFY_API_TOKEN) {
    return res.status(503).json({ error: 'Scraping service not configured' });
  }

  try {
    let username = profileUrl.trim();
    let platform = 'tiktok';

    if (username.includes('instagram.com')) {
      platform = 'instagram';
      // Extract from: https://www.instagram.com/username/
      const match = username.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
      if (match) username = match[1];
    } else if (username.includes('tiktok.com/')) {
      const match = username.match(/@([a-zA-Z0-9_.]+)/);
      if (match) username = match[1];
      else {
        const parts = username.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        username = last.startsWith('@') ? last.slice(1) : last;
      }
    }
    username = username.replace('@', '').split(/[?#/]/)[0];

    console.log(`🕵️ Competitor Spy: Scanning @${username} on ${platform}...`);

    const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
    let videos = [];

    if (platform === 'tiktok') {
      const run = await apifyClient.actor('clockworks/tiktok-scraper').call({
        profiles: [`https://www.tiktok.com/@${username}`],
        resultsPerPage: 20,
        shouldDownloadVideos: false,
        shouldDownloadCovers: true,
      }, { timeout: 120 });

      if (!run?.defaultDatasetId) {
        throw new Error('TikTok Scraper failed to initialize dataset.');
      }

      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

      if (items && items.length > 0) {
        videos = items
          .filter(item => item.webVideoUrl || item.videoUrl)
          .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
          .map(item => ({
            id: item.id,
            url: item.webVideoUrl || item.videoUrl,
            thumbnail: item.videoMeta?.coverUrl || item.covers?.default || '',
            caption: (item.text || '').substring(0, 200),
            views: item.playCount || 0,
            likes: item.diggCount || 0,
            comments: item.commentCount || 0,
            shares: item.shareCount || 0,
            date: item.createTimeISO || item.createTime,
            music: item.musicMeta?.musicName || '',
          }));
      }
    } else {
      // Instagram Spying (Using Apify Instagram Scraper)
      const run = await apifyClient.actor('apify/instagram-scraper').call({
        usernames: [username],
        resultsType: 'posts',
        resultsLimit: 20,
        addParentData: true,
      }, { timeout: 120 });

      if (!run?.defaultDatasetId) {
        throw new Error('Instagram Scraper failed to initialize dataset.');
      }

      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

      if (items && items.length > 0) {
        videos = items
          .filter(item => item.type === 'Video' || item.type === 'Sidecar')
          .sort((a, b) => (b.videoPlayCount || b.likesCount || 0) - (a.videoPlayCount || a.likesCount || 0))
          .map(item => ({
            id: item.id,
            url: item.url,
            thumbnail: item.displayUrl,
            caption: (item.caption || '').substring(0, 200),
            views: item.videoPlayCount || 0,
            likes: item.likesCount || 0,
            comments: item.commentsCount || 0,
            shares: 0,
            date: item.timestamp,
            music: '',
          }));
      }
    }

    if (videos.length === 0) {
      return res.json({ success: true, username, videos: [], message: `No videos found for this ${platform} profile.` });
    }

    console.log(`🕵️ Competitor Spy: Found ${videos.length} videos for @${username}`);

    res.json({
      success: true,
      username,
      videoCount: videos.length,
      videos,
    });

  } catch (error) {
    console.error('Competitor Spy error:', error);
    res.status(500).json({ error: 'Failed to scan competitor profile', details: error.message });
  }
});

// ============================================
// TEAM MEMBERS (Agency Only)
// ============================================

// Invite a team member
app.post('/api/team/invite', authenticateClerk, async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Plan Gating: Agency Only
  const tier = req.user.subscription_tier || 'free';
  if (tier !== 'agency') {
    return res.status(403).json({
      error: 'Agency Access Required',
      details: 'Team Members is an Agency plan feature. Upgrade to collaborate with your team.'
    });
  }

  try {

    // Check member limit (max 5)
    const [{ count }] = await sql`SELECT count(*)::int FROM team_members WHERE owner_id = ${req.user.id}`;
    if (count >= 5) {
      return res.status(400).json({ error: 'Maximum 5 team members allowed on the Agency plan.' });
    }

    // Check if already invited
    const [existing] = await sql`SELECT id FROM team_members WHERE owner_id = ${req.user.id} AND member_email = ${email}`;
    if (existing) {
      return res.status(400).json({ error: 'This email has already been invited.' });
    }

    // Check if user exists in system
    const [existingUser] = await sql`SELECT id FROM users WHERE email = ${email}`;

    const [member] = await sql`
      INSERT INTO team_members (owner_id, member_email, member_user_id, status, joined_at)
      VALUES (${req.user.id}, ${email}, ${existingUser?.id || null}, ${existingUser ? 'active' : 'pending'}, ${existingUser ? new Date() : null})
      RETURNING *
    `;

    // If user exists, grant them agency-level access
    if (existingUser) {
      await sql`UPDATE users SET subscription_tier = 'agency' WHERE id = ${existingUser.id}`;
    }

    console.log(`👥 Team: ${req.user.email} invited ${email} (${existingUser ? 'active' : 'pending'})`);
    res.json({ success: true, member });

  } catch (error) {
    console.error('Team invite error:', error);
    res.status(500).json({ error: 'Failed to invite team member' });
  }
});

// List team members
app.get('/api/team/members', authenticateClerk, async (req, res) => {
  try {
    const members = await sql`
      SELECT tm.*, u.name as member_name, u.image as member_image
      FROM team_members tm
      LEFT JOIN users u ON tm.member_user_id = u.id
      WHERE tm.owner_id = ${req.user.id}
      ORDER BY tm.invited_at DESC
    `;
    res.json(members);
  } catch (error) {
    console.error('Fetch team error:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

// Remove team member
app.delete('/api/team/remove/:memberId', authenticateClerk, async (req, res) => {
  try {
    const { memberId } = req.params;

    // Get member info before deleting
    const [member] = await sql`SELECT * FROM team_members WHERE id = ${memberId} AND owner_id = ${req.user.id}`;
    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    // Revoke their agency access if they were linked
    if (member.member_user_id) {
      await sql`UPDATE users SET subscription_tier = 'free' WHERE id = ${member.member_user_id}`;
    }

    await sql`DELETE FROM team_members WHERE id = ${memberId} AND owner_id = ${req.user.id}`;

    console.log(`👥 Team: Removed ${member.member_email} from ${req.user.email}'s team`);
    res.json({ success: true });

  } catch (error) {
    console.error('Remove team member error:', error);
    res.status(500).json({ error: 'Failed to remove team member' });
  }
});

// ============================================
// GUMROAD PING WEBHOOK
// ============================================
app.post('/api/webhooks/gumroad', async (req, res) => {
  try {
    const {
      email,
      product_permalink,
      subscription_id,
      is_recurring_charge,
      refunded,
      sale_id,
      price,
      product_name,
      test: isTest
    } = req.body;

    console.log(`🔔 Gumroad Ping received: ${product_name || product_permalink} | ${email} | Sale: ${sale_id}`);

    if (!email) {
      console.warn('Gumroad Ping: No email in payload');
      return res.status(200).json({ status: 'ignored', reason: 'no email' });
    }

    // Find user by email
    const [user] = await sql`SELECT id, subscription_tier FROM users WHERE email = ${email}`;

    if (!user) {
      console.warn(`Gumroad Ping: No user found for email ${email}`);
      return res.status(200).json({ status: 'ignored', reason: 'user not found' });
    }

    // Handle refund or cancellation
    const isRefunded = refunded === 'true' || refunded === true;
    const isCancelled = req.body.subscription_cancelled_at || req.body.is_subscription_ended === 'true' || req.body.is_subscription_ended === true;

    if (isRefunded || isCancelled) {
      console.log(`💸 Downgrade detected for ${email} (Refund: ${isRefunded}, Cancel: ${isCancelled}), reverting to free`);
      await sql`
        UPDATE users
        SET subscription_tier = 'free',
            subscription_status = ${isRefunded ? 'refunded' : 'cancelled'},
            updated_at = NOW()
        WHERE id = ${user.id}
      `;
      return res.status(200).json({ status: 'downgraded', reason: isRefunded ? 'refund' : 'cancel' });
    }

    // Determine plan from product_permalink or product_name
    let subscriptionTier = 'founding'; // default to founding
    const nameLower = (product_name || '').toLowerCase();
    const permalinkLower = (product_permalink || '').toLowerCase();

    if (nameLower.includes('agency') || permalinkLower.includes('agency')) {
      subscriptionTier = 'agency';
    }

    // Update user subscription
    await sql`
      UPDATE users
      SET subscription_tier = ${subscriptionTier},
          subscription_status = 'active',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;

    console.log(`✅ User ${email} upgraded to ${subscriptionTier} | Sale: ${sale_id} | Sub: ${subscription_id || 'N/A'}`);
    return res.status(200).json({ status: 'success', tier: subscriptionTier });

  } catch (err) {
    console.error('Gumroad Webhook Error:', err);
    return res.status(200).json({ status: 'error', message: err.message });
  }
});

app.listen(port, async () => {
  console.log(`Server running on port ${port} `);

  try {
    const isHealthy = await testConnection();
    if (isHealthy) {
      const countRes = await sql`SELECT count(*) FROM ads`;
      console.log(`✅ Startup Neon Connection Successful! Ads in DB: ${countRes[0].count} `);
    }
  } catch (err) {
    console.error('❌ Startup Database connection failed:', err.message);
  }
});
