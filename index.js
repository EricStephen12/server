const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const path = require('path');
const Sentry = require('@sentry/node');

dotenv.config();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
}

const Groq = require('groq-sdk');
const multer = require('multer');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');
const { selectSmartFrames } = require('./utils/smartFrameSelector');
const { sql, testConnection } = require('./db/index');
const prisma = require('./db/prisma');
const adminRouter = require('./routes/admin');
const supportRouter = require('./routes/support');
const revenuecatWebhooks = require('./routes/revenuecat');
const polarWebhooks = require('./routes/polar');
const userRouter = require('./routes/user');
const waitlistRouter = require('./routes/waitlist');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireOwnership } = require('./middleware/clerkAuth');
const { sanitizeVideoUrl } = require('./utils/sanitize');
const { enqueueVideoJob, getQueueStats } = require('./utils/videoQueue');
const { getCachedAnalysis, setCachedAnalysis, getCacheStats } = require('./utils/analysisCache');
const { analyzeQueue, processAnalysisJob } = require('./utils/queue');
const { sendUpgradeNudgeEmail } = require('./utils/emails');
const { transcribeAudio } = require('./utils/audioTranscriber');
const fs = require('fs');


process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const app = express();
const port = process.env.PORT || 4000;

app.set('trust proxy', 1);

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ 
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

// Voice Lounge mic clips (MediaRecorder → Groq Whisper)
const audioUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB — ~2 min of webm/opus
  fileFilter: (req, file, cb) => {
    const type = (file.mimetype || '').toLowerCase();
    const ok =
      type.startsWith('audio/') ||
      type === 'video/webm' || // Chrome often labels audio-only recordings this way
      type === 'application/octet-stream';
    if (ok) cb(null, true);
    else cb(new Error('Only audio recordings are allowed'));
  },
});

function audioExtensionForMime(mime) {
  const type = (mime || '').toLowerCase();
  if (type.includes('wav')) return '.wav';
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3';
  if (type.includes('mp4') || type.includes('m4a')) return '.m4a';
  if (type.includes('ogg')) return '.ogg';
  return '.webm';
}

app.use(cors({
  origin: function (origin, callback) {
    // Dynamically whitelist any origin so it works flawlessly with custom domains
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

app.use(helmet());
app.use(cookieParser());

// Global limiter — 150 req per 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' }
});

// Strict limiter for expensive AI routes — 20 req per 15 min per IP
const scanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scan requests. Please wait before trying again.' }
});

// Auth/registration limiter — 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please wait.' }
});

app.use('/api/', globalLimiter);


app.use('/api/webhooks/revenuecat', revenuecatWebhooks);
// IMPORTANT: Polar webhook must be mounted BEFORE express.json() so raw body is preserved for signature verification
app.use('/api/webhooks/polar', polarWebhooks);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let groq;
try {
  if (process.env.GROQ_API_KEY) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
  } else {

  }
} catch (err) {

}

app.get('/health', async (req, res) => {
  const cacheStats = await getCacheStats();
  res.json({
    status: 'ok',
    timestamp: new Date(),
    message: 'Server is running.',
    groq_configured: !!groq,
    cache: cacheStats
  });
});

const { resolveInternalId } = require('./utils/userResolver');

app.use('/api/admin', adminRouter);
app.use('/api/support', supportRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api/auth', authLimiter); // Rate limit auth endpoints
app.use('/api', userRouter);



// Voice Lounge STT — Groq Whisper (whisper-large-v3-turbo)
app.post('/api/transcribe', requireAuth, audioUpload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'audio file is required (field name: audio)' });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'GROQ_API_KEY not configured' });
  }

  const ext = audioExtensionForMime(req.file.mimetype);
  const namedPath = `${req.file.path}${ext}`;
  try {
    fs.renameSync(req.file.path, namedPath);
  } catch (renameErr) {
    console.error('[transcribe] rename failed:', renameErr.message);
    try { fs.unlinkSync(req.file.path); } catch (_) { /* ignore */ }
    return res.status(500).json({ error: 'Failed to prepare audio for transcription' });
  }

  try {
    const { normalizeAudioForWhisper } = require('./utils/normalizeAudio');
    let whisperPath = namedPath;
    try {
      whisperPath = await normalizeAudioForWhisper(namedPath);
    } catch (normErr) {
      console.warn('[transcribe] audio normalize skipped:', normErr.message);
    }

    const text = await transcribeAudio(whisperPath);
    const cleaned = (text || '').trim();
    if (!cleaned) {
      return res.status(422).json({ error: 'No speech detected' });
    }
    return res.json({ text: cleaned });
  } catch (err) {
    console.error('[transcribe] failed:', err.message);
    return res.status(502).json({ error: 'Transcription failed', detail: err.message });
  }
});

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.get('/api/debug', requireAuth, async (req, res) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const axios = require('axios');
  const report = {};

report.env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    PORT: process.env.PORT,
  };

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

  try {
    const { ytdlpReady } = require('./utils/ytdlpPath');
    report.ytdlp = ytdlpReady();
  } catch (e) {
    report.ytdlp = { ready: false, error: e.message };
  }

try {
    const testFile = '/tmp/debug_test.txt';
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    report.tmp_writable = true;
  } catch (e) {
    report.tmp_writable = false;
    report.tmp_error = e.message;
  }

try {
    const tikwmRes = await axios.post('https://tikwm.com/api/',
      'url=https://www.tiktok.com/@tiktok/video/6584647400055855365&hd=1',
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    report.tikwm = { reachable: true, code: tikwmRes.data?.code, has_data: !!tikwmRes.data?.data };
  } catch (e) {
    report.tikwm = { reachable: false, error: e.message };
  }

try {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    const testGroq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const models = await testGroq.models.list();
    report.groq = { reachable: true, model_count: models.data?.length };
  } catch (e) {
    report.groq = { reachable: false, error: e.message };
  }

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







app.get('/api/test-tiktok', requireAuth, async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'Pass ?url=TIKTOK_URL' });
  const axios = require('axios');
  const fs = require('fs');
  const ffmpeg = require('fluent-ffmpeg');
  const ffmpegStatic = require('ffmpeg-static');
  const ffprobeStatic = require('@ffprobe-installer/ffprobe');
  if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
  if (ffprobeStatic.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

  const result = { url: videoUrl, steps: {} };
  let videoDownloadUrl = null;
  const testVideoPath = '/tmp/test_video_' + Date.now() + '.mp4';

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

app.post('/api/save-to-vault', requireAuth, requireOwnership, async (req, res) => {
  let { userId, title, videoUrl, visualDna } = req.body;

  if (!userId || !videoUrl) {
    return res.status(400).json({ error: 'User ID and Video URL are required' });
  }

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  try {
    const [data] = await sql`
      INSERT INTO ads (title, video_url, visual_dna, is_verified)
      VALUES (${title || 'Saved Ad'}, ${videoUrl}, ${JSON.stringify(visualDna)}, true)
      RETURNING *
    `;

await sql`UPDATE users SET total_pins = total_pins + 1 WHERE id = ${userId}`;

    res.json({ success: true, ad: data });
  } catch (error) {

    res.status(500).json({ error: 'Failed to save to vault' });
  }
});

app.get('/api/user-ads', requireAuth, async (req, res) => {
  let { userId, search, niche } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

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

    res.status(500).json({ error: 'Failed to fetch user ads' });
  }
});

async function checkLimits(inputUserId, type) {
  try {
    const userId = await resolveInternalId(inputUserId);
    if (!userId) return { allowed: true };

    // created_at is required so the monthly cycle matches /api/me (account day-of-month)
    const [user] = await sql`
      SELECT subscription_tier, credits_remaining, created_at
      FROM users WHERE id = ${userId}
    `;
    let tier = user?.subscription_tier || 'free';
    if (tier === 'agency') tier = 'studio';
    if (tier === 'founding') tier = 'creator';

    const limits = {
      free: 3,
      creator: 30,
      studio: 100,
      agency: 100,
      founding: 30,
    };

    const userLimit = limits[tier] ?? 3;

    // Billing cycle start — same day of month as account creation (matches /api/me)
    const cycleAnchor = new Date(user?.created_at || new Date());
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), cycleAnchor.getDate());
    if (cycleStart > now) {
      cycleStart.setMonth(cycleStart.getMonth() - 1);
    }

    if (type === 'scan') {
      const [{ count }] = await sql`
        SELECT count(*)::int FROM scan_events 
        WHERE user_id = ${userId} AND created_at >= ${cycleStart}
      `;

      // Monthly quota first; admin bonus credits only after the plan cap is reached.
      if (count < userLimit) {
        // Fire upgrade nudge email at 80% usage (once per cycle) — non-blocking
        const pct = userLimit > 0 ? count / userLimit : 0;
        if (pct >= 0.8 && pct < 1 && tier !== 'studio') {
          try {
            const [userData] = await sql`SELECT email, name FROM users WHERE id = ${userId}`;
            if (userData?.email) {
              sendUpgradeNudgeEmail({
                name: userData.name,
                email: userData.email,
                scansUsed: count,
                scanLimit: userLimit,
                plan: tier
              }).catch(() => {});
            }
          } catch (_) {}
        }

        return { allowed: true, count, limit: userLimit, usedBonus: false };
      }

      const bonusCredits = user?.credits_remaining || 0;
      if (bonusCredits > 0) {
        const [updated] = await sql`
          UPDATE users
          SET credits_remaining = credits_remaining - 1
          WHERE id = ${userId} AND credits_remaining > 0
          RETURNING credits_remaining
        `;
        if (updated) {
          return { allowed: true, count, limit: userLimit, usedBonus: true };
        }
      }

      return { allowed: false, count, limit: userLimit, usedBonus: false };
    }

    if (type === 'script') {
      const [{ count }] = await sql`
        SELECT count(*)::int FROM scripts 
        WHERE user_id = ${userId} AND created_at >= ${cycleStart}
      `;
      return { allowed: count < userLimit, count, limit: userLimit };
    }

    return { allowed: true };
  } catch (err) {
    console.error('[checkLimits] Error:', err.message);
    return { allowed: true }; // Allow on error to avoid blocking users
  }
}

app.post('/api/batch-analyze', requireAuth, requireOwnership, scanLimiter, async (req, res) => {
  let { urls, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of URLs' });
  }

  if (urls.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 URLs per batch' });
  }

const [userData] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
  const tier = userData?.subscription_tier || 'free';
  if (tier !== 'studio' && tier !== 'agency') {
    return res.status(403).json({
      error: 'Studio Access Required',
      details: 'Batch Analysis is exclusive to The Studio Plan. Upgrade to unlock bulk DNA extraction.'
    });
  }

const results = [];

  const concurrencyLimit = 3;
  const processVideo = async (videoUrl, index) => {
    const url = videoUrl.trim();
    if (!url) return { url, success: false, error: 'Empty URL' };

    try {

      const { frames, audioPath } = await extractFrames(url);

      if (!frames || frames.length === 0) {
        return { url, success: false, error: 'No frames extracted' };
      }

      let transcript = "";
      let music = null;
      if (audioPath) {
        try {
          music = await identifyMusic(audioPath);
        } catch(e) {  }
        
        try {
          transcript = await transcribeAudio(audioPath);
        } catch (err) {
        }
      }

      const analysis = await analyzeVideoFrames(frames, `Analysis of: ${url}`, transcript, music);
      analysis.transcript = transcript;
      analysis.music = music;

try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${userId}`;
      } catch (err) {

      }

return {
        url,
        success: true,
        analysis,
        framesAnalyzed: frames.length,
        hasAudio: !!transcript
      };
    } catch (error) {

      return { url, success: false, error: error.message };
    }
  };

for (let i = 0; i < urls.length; i += concurrencyLimit) {
    const chunk = urls.slice(i, i + concurrencyLimit);
    const chunkResults = await Promise.all(chunk.map((url, j) => processVideo(url, i + j)));
    results.push(...chunkResults);
  }

  const successCount = results.filter(r => r.success).length;

res.json({
    success: true,
    total: urls.length,
    completed: successCount,
    failed: urls.length - successCount,
    results
  });
});

app.post('/api/export-report', requireAuth, requireOwnership, async (req, res) => {
  let { analysis, videoUrl, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
  const tier = user?.subscription_tier || 'free';
  if (tier !== 'studio' && tier !== 'agency') {
    return res.status(403).json({
      error: 'Studio Access Required',
      details: 'Report Exporting is a Studio plan feature. Upgrade to unlock full DNA dossiers.'
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

    res.status(500).json({ error: 'Failed to generate report' });
  }
});




app.post('/api/analyze', requireAuth, requireOwnership, scanLimiter, express.json({ limit: '10mb' }), async (req, res) => {
  let { sourceUrl, userId, mode, niche } = req.body;
  if (!sourceUrl) return res.status(400).json({ error: 'Video URL required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  let plan = 'free';
  let usedBonus = false;
  if (userId) {
    const limit = await checkLimits(userId, 'scan');
    if (!limit.allowed) {
      return res.status(403).json({
        error: 'Creative License Inactive',
        details: 'You need an active subscription or trial to scan videos. Upgrade now to get started!',
        upgradeRequired: true
      });
    }
    usedBonus = !!limit.usedBonus;

    try {
      const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
      if (user && user.subscription_tier) plan = user.subscription_tier;
    } catch(err) {}
  }

  // Tier-based length validation
  let maxLength = 90; // free
  let maxFrames = 5;
  if (plan === 'creator' || plan === 'founding') {
      maxLength = 300; // 5 mins
      maxFrames = 15;
  } else if (plan === 'studio' || plan === 'agency') {
      maxLength = 1800; // 30 mins
      maxFrames = 25;
  }

  try {
    const originalUrl = sourceUrl || 'Direct Upload';
    const cleanTitle = `Analysis: ${originalUrl.substring(0, 30)}...`;
    
    // Create new lounge session in "processing" state
    const tempDna = { status: 'processing' };
    const [session] = await sql`
      INSERT INTO lounge_sessions(user_id, title, video_url, dna, messages, created_at, updated_at)
      VALUES(${userId}, ${cleanTitle}, ${originalUrl}, ${JSON.stringify(tempDna)}, '[]', NOW(), NOW())
      RETURNING id
    `;

    // Enqueue the heavy processing to BullMQ worker
    const jobData = {
      sessionId: session.id,
      userId,
      originalUrl,
      niche,
      mode: mode || 'ad',
      maxFrames,
      maxLength
    };

    // Every started scan counts toward monthly usage (including bonus-overflow scans).
    try {
      await sql`INSERT INTO scan_events (user_id, created_at) VALUES (${userId}, NOW())`;
    } catch (scanEventErr) {
      console.error('[Analyze] Failed to insert scan_event:', scanEventErr.message);
    }

    try {
      await analyzeQueue.add('analyze-video', jobData);
    } catch (queueErr) {
      console.warn('[Queue] BullMQ failed (likely Redis limit exceeded). Falling back to background promise:', queueErr.message);
      // Fallback: run it in the background manually
      processAnalysisJob(jobData).catch(err => {
        console.error('[Fallback] Background analysis failed:', err);
      });
    }

    res.json({ success: true, sessionId: session.id });
  } catch (error) {
    res.status(500).json({ error: 'Video audit failed', details: error.message });
  }
});

app.post('/api/product-intel', requireAuth, requireOwnership, scanLimiter, express.json({ limit: '10mb' }), async (req, res) => {
  let { sourceUrl, userId } = req.body;
  if (!sourceUrl) return res.status(400).json({ error: 'Video URL required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  let plan = 'free';
  let usedBonus = false;
  if (userId) {
    const limit = await checkLimits(userId, 'scan');
    if (!limit.allowed) {
      return res.status(403).json({
        error: 'Creative License Inactive',
        details: 'You need an active subscription or trial to scan videos. Upgrade now to get started!',
        upgradeRequired: true
      });
    }
    usedBonus = !!limit.usedBonus;

    try {
      const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
      if (user && user.subscription_tier) plan = user.subscription_tier;
    } catch(err) {}
  }

  // Tier-based length validation
  let maxLength = 90; // free
  let maxFrames = 5;
  if (plan === 'creator' || plan === 'founding') {
      maxLength = 300; // 5 mins
      maxFrames = 15;
  } else if (plan === 'studio' || plan === 'agency') {
      maxLength = 1800; // 30 mins
      maxFrames = 25;
  }

  try {
    const originalUrl = sourceUrl || 'Direct Upload';
    const cleanTitle = `Product Intel: ${originalUrl.substring(0, 30)}...`;
    
    // Create new lounge session in "processing" state
    const tempDna = { status: 'processing', mode: 'product-intel' };
    const [session] = await sql`
      INSERT INTO lounge_sessions(user_id, title, video_url, dna, messages, created_at, updated_at)
      VALUES(${userId}, ${cleanTitle}, ${originalUrl}, ${JSON.stringify(tempDna)}, '[]', NOW(), NOW())
      RETURNING id
    `;

    // Enqueue the heavy processing to BullMQ worker
    const jobData = {
      sessionId: session.id,
      userId,
      originalUrl,
      niche: 'Product Identification', // default niche
      mode: 'product-intel',
      maxFrames,
      maxLength,
      plan
    };

    try {
      await sql`INSERT INTO scan_events (user_id, created_at) VALUES (${userId}, NOW())`;
    } catch (scanEventErr) {
      console.error('[Product Intel] Failed to insert scan_event:', scanEventErr.message);
    }

    try {
      await analyzeQueue.add('analyze-video', jobData);
    } catch (queueErr) {
      console.warn('[Queue] BullMQ failed (likely Redis limit exceeded). Falling back to background promise:', queueErr.message);
      // Fallback: run it in the background manually
      processAnalysisJob(jobData).catch(err => {
        console.error('[Fallback] Background analysis failed:', err);
      });
    }

    res.json({ success: true, sessionId: session.id });
  } catch (error) {
    res.status(500).json({ error: 'Product intel setup failed', details: error.message });
  }
});

// ── Manual Video Upload ──────────────────────────────────────────────────────
app.post('/api/upload', requireAuth, scanLimiter, upload.single('file'), async (req, res) => {
  let { userId, mode, niche } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No video file provided' });

  // Validate MIME type
  if (!req.file.mimetype.startsWith('video/')) {
    const fs = require('fs');
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: 'Only video files are supported' });
  }

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  let plan = 'free';
  const limit = await checkLimits(userId, 'scan');
  if (!limit.allowed) {
    const fs = require('fs');
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(403).json({
      error: 'Creative License Inactive',
      details: 'You need an active subscription or trial to scan videos. Upgrade now to get started!',
      upgradeRequired: true
    });
  }
  const usedBonus = !!limit.usedBonus;

  try {
    const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
    if (user && user.subscription_tier) plan = user.subscription_tier;
  } catch (err) {}

  // Tier-based file size limits: free=50MB, creator=200MB, studio=500MB
  const maxSizeBytes = (plan === 'studio' || plan === 'agency')
    ? 500 * 1024 * 1024
    : (plan === 'creator' || plan === 'founding')
      ? 200 * 1024 * 1024
      : 50 * 1024 * 1024;
  if (req.file.size > maxSizeBytes) {
    const fs = require('fs');
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: `File too large. Your plan allows up to ${maxSizeBytes / (1024 * 1024)}MB.` });
  }

  let maxLength = 90;
  let maxFrames = 5;
  if (plan === 'creator' || plan === 'founding') { maxLength = 300; maxFrames = 15; }
  else if (plan === 'studio' || plan === 'agency') { maxLength = 1800; maxFrames = 25; }

  try {
    const originalFileName = req.file.originalname || 'Uploaded Video';
    const cleanTitle = `Upload: ${originalFileName.substring(0, 40)}`;

    const [session] = await sql`
      INSERT INTO lounge_sessions(user_id, title, video_url, dna, messages, created_at, updated_at)
      VALUES(${userId}, ${cleanTitle}, ${'local:' + req.file.path}, ${JSON.stringify({ status: 'processing' })}, '[]', NOW(), NOW())
      RETURNING id
    `;

    const jobData = {
      sessionId: session.id,
      userId,
      originalUrl: 'Direct Upload',
      localFilePath: req.file.path,
      niche,
      mode: mode || 'ad',
      maxFrames,
      maxLength
    };

    try {
      await sql`INSERT INTO scan_events (user_id, created_at) VALUES (${userId}, NOW())`;
    } catch (scanEventErr) {
      console.error('[Upload] Failed to insert scan_event:', scanEventErr.message);
    }

    try {
      await analyzeQueue.add('analyze-video', jobData);
    } catch (queueErr) {
      console.warn('[Queue] BullMQ failed for upload, falling back:', queueErr.message);
      processAnalysisJob(jobData).catch(err => {
        console.error('[Fallback] Upload analysis failed:', err);
      });
    }

    res.json({ success: true, sessionId: session.id });
  } catch (error) {
    res.status(500).json({ error: 'Upload processing failed', details: error.message });
  }
});

app.post('/api/generate-script', requireAuth, requireOwnership, async (req, res) => {
  let { productName, description, adId, answers, privateDna, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  if (!productName || !description) {
    return res.status(400).json({ error: 'Product name and description are required' });
  }

  if (!groq) {
    return res.status(503).json({ error: 'AI service not available (API Key Missing)' });
  }

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

if (adId) {
      const [adData] = await sql`SELECT * FROM ads WHERE id = ${adId}`;

      if (adData) {

        if (adData.visual_dna) {

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

        else if (adData.video_url && process.env.GEMINI_API_KEY) {
          try {

            const frames = await extractFrames(adData.video_url);
            visualAnalysis = await analyzeVideoFrames(frames, `${productName} - ${description}`);

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

        Generate an Agency-Grade Viral Production Guide that a creator can FILM FROM TODAY.
        Every instruction must be specific enough to hand to a videographer with zero context.

        Output JSON only: { 
            "summary": {
                "hook": "Exact words + visual for first 2 seconds", 
                "problem": "How to visually show the pain point in 3-5 seconds", 
                "solution": "How to demo the product as the answer", 
                "cta": "The exact closing words + on-screen text"
            },
            "shot_list": [
                { 
                    "time": "0:00 - 0:02", 
                    "duration_seconds": 2,
                    "shot_type": "CLOSE-UP | WIDE | MEDIUM | POV | SCREEN-RECORD",
                    "subject": "Exactly what is in frame — hands, face, product, environment",
                    "camera": "Handheld/Tripod, angle, movement direction",
                    "audio": "Exact script line to say OR 'no dialogue — music only'",
                    "text_overlay": "Exact text to put on screen, font style, position",
                    "energy": "Low | Building | Peak | Cool-down",
                    "reference": "Which element from the source ad this mimics and why"
                }
            ],
            "music_direction": {
                "vibe": "Describe the exact mood — e.g. 'Lo-fi with subtle bass buildup'",
                "bpm_range": "90-110",
                "search_tip": "What to search on TikTok/CapCut to find similar sounds",
                "drop_timing": "When the music should peak — e.g. 'at the product reveal (0:08)'"
            },
            "thumbnail_direction": {
                "description": "What the thumbnail/cover image should show",
                "text": "What text to overlay on the thumbnail",
                "why": "Why this thumbnail will get clicks"
            },
            "aesthetic_guide": {
                "lighting": "Specific lighting setup — e.g. 'Ring light from 45° left, warm tone'",
                "color_palette": "Exact mood — e.g. 'Warm earth tones, slightly desaturated'",
                "editing_pace": "Cut frequency — e.g. 'New shot every 1.5-2s during hook, slow to 3-4s in solution'",
                "props_needed": "List of physical items needed for the shoot"
            }
        }

        CRITICAL: The shot_list must have at least 5 entries covering the full video duration.
        Each entry must be specific enough that someone who has NEVER seen the original ad could film it perfectly.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    const fullGuide = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const scriptContent = fullGuide.summary || fullGuide; // Backward compatibility for DB save

if (sql && userId) {
      try {
        await sql`
          INSERT INTO scripts (user_id, product_name, description, script_content, created_at)
          VALUES (${userId}, ${productName}, ${description}, ${JSON.stringify(scriptContent)}, ${new Date()})
        `;
      } catch (dbErr) {

      }
    }

if (sql && userId) {
      try {
        await sql`
          UPDATE users 
          SET total_scripts = total_scripts + 1
          WHERE id = ${userId}
        `;
      } catch (statErr) {

      }
    }

    res.json(fullGuide);

  } catch (error) {

    res.status(500).json({ error: 'Failed to generate script', details: error.message });
  }
});

const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};

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

    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

app.post('/api/script-strategy-questions', requireAuth, requireOwnership, async (req, res) => {
  let { adId, productName, description, privateDna, userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'User ID required' });
  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  if (!adId && !privateDna) return res.status(400).json({ error: 'Ad ID or Private DNA is required' });

  try {
    let adData = { title: "Private Analysis", niche: "custom" };
    let visualContext = "";

    if (adId) {
      const [data] = await sql`SELECT * FROM ads WHERE id = ${adId}`;
      if (data) adData = data;

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

    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/creative-director-chat', requireAuth, requireOwnership, express.json({ limit: '2mb' }), async (req, res) => {
  let { messages, dna, isRoastMode, userId, voiceMode, stream } = req.body;
  voiceMode = !!voiceMode;
  const wantStream = !!stream && voiceMode;

  // Frame JPEG previews live in session DNA for UI only — never send to the LLM.
  if (dna && typeof dna === 'object' && Array.isArray(dna.frames)) {
    const { frames: _frames, ...dnaRest } = dna;
    dna = dnaRest;
  }

  // groq check removed in favor of openrouter

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  let plan = 'free';
  try {
    const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
    if (user && user.subscription_tier) plan = user.subscription_tier;
  } catch (err) {
    console.error('Failed to fetch user plan for chat routing:', err);
  }

  try {
    const isIntro = !messages || messages.length === 0;
    const isProductIntel = dna.mode === 'product-intel' || !!dna.productName;

    const dnaContext = isProductIntel ? `
    THE DECONSTRUCTED DNA (PRODUCT INTELLIGENCE):
    - **Product**: ${dna.productName} (${dna.category})
    - **Market Stage**: ${dna.marketStage}
    - **Verdict**: "${dna.verdict}"
    - **Market Position**: ${dna.marketPosition}
    - **Saturation**: ${dna.saturationScore}/10 - ${dna.saturationReality}
    - **Profit Viability**: ${dna.profitViabilityScore}/10
    - **Audience & Pain Fit**: ${dna.audiencePainFitScore}/10 - ${dna.audienceAndPainPoint}
    - **Risk Factor**: ${dna.moneyRisk}
    - **The Bottom Line**: "${dna.bottomLine?.truth}" (Watch for: ${dna.bottomLine?.watchFor})
    ` : `
    THE DECONSTRUCTED DNA (AD/CONTENT INTELLIGENCE):
    - **Niche**: ${dna.niche || 'General'}
    - **The Big Idea**: "${dna.big_idea || 'Not identified'}"
    - **The Secret Sauce**: "${dna.the_secret_sauce || 'Not identified'}"
    - **Hook Verdict**: ${dna.hook_verdict?.what_stops_the_scroll || dna.hook_analysis?.critique || 'No hook data'}
    - **Fatal Flaw**: ${dna.fatal_flaw || 'None identified'}
    - **Steal-Worthy Element**: ${dna.steal_worthy || 'None identified'}
    - **Retention Map**: ${dna.retention_map?.critique || dna.pacing_analysis?.critique || 'Standard pacing'}
    - **Full Transcript**: "${dna.transcript || 'No transcript data'}"
    - **Psychology Trigger**: ${dna.psychology_breakdown?.primary_trigger || 'Not identified'} — ${dna.psychology_breakdown?.explanation || ''}
    
    PERFORMANCE SCORES:
    - **Hook**: ${dna.metrics?.hook_power || 'N/A'}/10 (Visual: ${dna.hook_verdict?.visual_hook_grade || 'N/A'}, Audio: ${dna.hook_verdict?.spoken_hook_grade || 'N/A'})
    - **Retention**: ${dna.metrics?.retention_score || 'N/A'}/10
    - **CTA**: ${dna.metrics?.conversion_trigger || 'N/A'}/10
    ${Array.isArray(dna.visual_triggers) && dna.visual_triggers.length
      ? `- **Director Frame Anchors**: ${dna.visual_triggers.map((t) => `${t.label || t.reason_key} @ ${t.timestamp_seconds}s`).join('; ')}`
      : ''}
    `;

    let collectiveBlock = '';
    try {
      const { retrieveRelevantPatterns, formatCollectivePromptBlock } = require('./utils/collectiveMemory');
      const patterns = await retrieveRelevantPatterns(dna || {}, { limit: voiceMode ? 3 : 5 });
      collectiveBlock = formatCollectivePromptBlock(patterns);
    } catch (memErr) {
      console.warn('[CollectiveMemory] chat retrieve skipped:', memErr.message);
    }

    const systemPrompt = `You are an Elite Creative Director & Media Buyer. 
    You don't talk like a robot. You talk like the smartest friend I have who spends $50k/day on TikTok ads. 
    
    YOUR VOICE:
    - Casual, direct, confident. 
    - Use media buyer slang: "stopping the scroll," "hook rate," "pattern interrupt," "hold time," "AOV," "whitelisting."
    - No fluff. No "authenticity" talk. Tell me why people's thumbs STOP (or why the product prints cash/burns cash).
    
    YOUR TASK:
    You have just PERSONALLY watched this video. You've deconstructed the frames. You know why it's winning (or why it's trash).
    
    ${isRoastMode ? 'YOUR PERSONA: ROAST MODE. Be ruthless. If the ad sucks, say it. If the hook is weak, tell me I\'m wasting money.' : 'YOUR PERSONA: Creative Director. Direct, high-stakes, elite.'}

    ${dnaContext}

    ${collectiveBlock}

    THE RULES:
    1. **ACTION OVER ANALYSIS**: Don't just analyze. Tell me what to film or what to sell. 
    2. **PUSH BACK**: If the user's product doesn't fit the viral angle, TELL THEM. "This won't work for a health supplement, but we can steal the transition style."
    3. **THE ANCHOR FIRST**: If you don't know what the user is selling yet (and it wasn't a product scan), YOU MUST ASK.
    4. **REMEMBER EVERYTHING**: Every piece of context the user gives (product, audience, budget) is now permanent for this session. Use it.

    ${isIntro ? `
    INSTRUCTION: This is the opening memo. 
    
    1. **The Verdict**: 1 sharp sentence on the video's potential or the product's viability. "This hook is a 9/10 scroll-stopper." or "This product is a saturated nightmare."
    2. **Why It Works**: Explain it like a human. "This works because it makes you feel like you're missing out on a secret."
    3. **The Question**: Before I give you the strategy, I need the context.
    
    End exactly with: ${isProductIntel ? '"Before we talk launch strategy — what\'s your budget and timeframe for testing this?"' : '"Before I break this down — what\'s your product and who are you selling to?"'}
    ` : isProductIntel ? 'Bridge the Product Intel to their strategy. Tell them exactly how to position this product or why they should drop it immediately. Give specific marketing angles.' : 'Bridge the DNA to their product. If they sell [Product], tell them exactly how to remix [Hook] for it. Always end with a suggestion for a script or hook variation.'}

    ${voiceMode ? `
    VOICE MODE (you are being spoken aloud via TTS — keep turns short so speech stays continuous):
    - Natural spoken English, like a sharp media buyer on a live call.
    - Hard cap: 2–4 short sentences, about 40–90 words total. Never ramble.
    - One clear point per turn. Do not trail off mid-point.
    - No markdown, bullets, emoji, headers, or lists — plain speech only.
    - End with at most one short follow-up question when it helps; otherwise stop cleanly.
    ${Array.isArray(dna?.visual_triggers) && dna.visual_triggers.length ? `- When you call out a visual beat, name an approximate second from the Director Frame Anchors so the UI can sync the frame.` : ''}
    ` : ''}
    `;

    let completion;
    const MAX_RETRIES = 3;
    const sanitizedMessages = (messages || []).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {

        if (plan === 'studio' && !voiceMode) {
          // Studio uses Claude Haiku via OpenRouter (text lounge)
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://eixora.com',
              'X-Title': 'Eixora Mobile',
            },
            body: JSON.stringify({
              model: 'anthropic/claude-3-haiku',
              messages: [
                { role: "system", content: systemPrompt },
                ...sanitizedMessages
              ],
              temperature: 0.7,
              max_tokens: 800,
            })
          });
          
          if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);
          const completionData = await response.json();
          completion = { choices: [{ message: { content: completionData.choices[0]?.message?.content } }] };
        } else if (voiceMode) {
          // Voice Lounge: short spoken turns — long TTS replies stall mid-speech on Kokoro
          if (!groq) throw new Error('GROQ_API_KEY not configured');
          if (wantStream) {
            // SSE token stream so the client can TTS sentence-by-sentence
            const groqStream = await groq.chat.completions.create({
              messages: [
                { role: 'system', content: systemPrompt },
                ...sanitizedMessages,
              ],
              model: 'llama-3.1-8b-instant',
              temperature: 0.55,
              max_tokens: 220,
              stream: true,
            }, { timeout: 20000 });

            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            if (typeof res.flushHeaders === 'function') res.flushHeaders();

            for await (const chunk of groqStream) {
              const delta = chunk.choices?.[0]?.delta?.content || '';
              if (delta) {
                res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
              }
            }
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            return res.end();
          }
          completion = await groq.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              ...sanitizedMessages
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.55,
            max_tokens: 220,
          }, { timeout: 20000 });
        } else {
          // Creator/Free text lounge uses Llama 70B via Groq
          if (!groq) throw new Error('GROQ_API_KEY not configured');
          completion = await groq.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              ...sanitizedMessages
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
          }, { timeout: 60000 });
        }
        break; // Success — exit retry loop
      } catch (err) {
        const isNetworkError = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(err.cause?.code);

        if (attempt < MAX_RETRIES && isNetworkError) {

          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }

    res.json({ message: completion.choices[0]?.message?.content });
  } catch (error) {
    console.error('Creative Director Chat Error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Creative Director is temporarily unavailable. Please try again.', details: error.message });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
      } catch (_) { /* already closed */ }
    }
  }
});

app.post('/api/save-lounge-session', requireAuth, requireOwnership, async (req, res) => {
  let { sessionId, videoUrl, dna, messages, title, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  const msgCount = Array.isArray(messages) ? messages.length : 0;

try {
    let result;
    if (sessionId && sessionId !== 'null' && sessionId !== 'undefined') {

      const [data] = await sql`
        UPDATE lounge_sessions 
        SET messages = ${JSON.stringify(messages)}, updated_at = ${new Date()}
        WHERE id = ${sessionId} AND user_id = ${userId}
        RETURNING *
      `;
      result = data;
      if (result) {

      } else {

      }
    }

    if (!result) {

      const cleanTitle = title || `Analysis: ${videoUrl ? videoUrl.substring(0, 30) : 'Video'}...`;
      const [data] = await sql`
        INSERT INTO lounge_sessions(user_id, title, video_url, dna, messages, created_at, updated_at)
        VALUES(${userId}, ${cleanTitle}, ${videoUrl}, ${JSON.stringify(dna)}, ${JSON.stringify(messages)}, ${new Date()}, ${new Date()})
        RETURNING *
      `;
      result = data;

    }
    if (result) {
      if (typeof result.dna === 'string') {
        try { result.dna = JSON.parse(result.dna); } catch(e){}
      }
      if (typeof result.messages === 'string') {
        try { result.messages = JSON.parse(result.messages); } catch(e){}
      }
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save session' });
  }
});

app.get('/api/user-sessions', requireAuth, async (req, res) => {
  let userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

if (userId === '00000000-0000-0000-0000-000000000000') {
    return res.json([]);
  }

try {
    const sessions = await prisma.loungeSession.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        videoUrl: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 20
    });

const formattedSessions = sessions.map(s => ({
      id: s.id,
      title: s.title,
      video_url: s.videoUrl,
      created_at: s.updatedAt
    }));

res.json(formattedSessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/generate-final-script', requireAuth, requireOwnership, async (req, res) => {
  let { messages, dna, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  if (!groq) return res.status(503).json({ error: 'AI service not available' });

  try {
    const finalPrompt = `AS THE ELITE CREATIVE DIRECTOR & DIRECT-RESPONSE MEDIA BUYER, SYNTHESIZE THIS MASTERMIND SESSION INTO A PRODUCTION GUIDE.
    
    ORIGINAL DNA:
  - Awareness Level: ${dna.awareness_level || dna.niche || 'General'}
  - Big Idea: ${dna.big_idea || 'Not identified'}
  - Hook Verdict: ${dna.hook_verdict?.what_stops_the_scroll || dna.hook_analysis?.critique || 'No hook data'}
  - Fatal Flaw: ${dna.fatal_flaw || 'None identified'}
  - Steal-Worthy: ${dna.steal_worthy || 'None identified'}
  - Secret Sauce: ${dna.the_secret_sauce || 'Not identified'}
    
    CHAT CONTEXT (THE USER PREFERENCES):
  ${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
    
    INSTRUCTIONS FOR NATIVE UGC HOOKS (DO NOT USE GENERIC TRANSFORMATION FORMULAS):
    1. DO NOT fall into the generic "before/after" commercial trap (e.g., "Tired? Try this supplement!"). Highly polished, dramatized commercials look like ads and get skipped instantly on TikTok/Reels.
    2. The first shot (0-3s) must be native, unskippable, and UGC-raw.
    3. Anchor the script's hook (0-3s) using ONE of these 3 high-converting UGC frameworks, whichever fits the product/niche best:
       - **The Counter-Intuitive Callout**: Visual showing the product container being unboxed aggressively or thrown into a bag. Overlay text: "Stop taking [generic/competitor category product] for [core problem]. Do this instead."
       - **The "Stitch/Reply" Format**: Visual of a green-screen background of a real/skeptical customer comment (e.g., "Bet this tastes like grass and does nothing lol"), with the creator taking a sip/capsule, making a shocked/impressed face, and immediately showing the texture of the product.
       - **The "Day in the Life" Integration**: Visual of the creator casually doing their morning routine (making coffee, getting dressed), keeping visual pacing casual, while the voiceover drops a heavy hook about the core problem/cognitive fog.
    
    4. Replicate the psychological energy of the original DNA but adapt for the new product using the chat context.
    5. The script must be high-AOV, high-RECOUP focused.
    
    Output JSON only:
{
  "title": "Viral Script Name",
  "concept": "Brief concept summary",
  "awareness_level": "${dna.awareness_level || dna.niche || 'General'}",
  "big_idea": "Synthesis of the chat + DNA",
  "shot_list": [
    { "time": "0-3s", "visual": "UGC framework hook visual description...", "audio": "Native hook voiceover/sound...", "overlay": "On-screen hook text overlay..." },
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

if (sql && userId) {

      const [newScript] = await sql`
        INSERT INTO scripts(user_id, title, script_content)
VALUES(${userId}, ${script.title}, ${JSON.stringify(script)})
RETURNING *
  `;

await sql`
        UPDATE users
        SET total_scripts = total_scripts + 1
        WHERE id = ${userId}
`;
    }

    res.json(script);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/lounge-session/:id', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const [session] = await sql`SELECT * FROM lounge_sessions WHERE id = ${sessionId}`;

    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session) {
      if (typeof session.dna === 'string') {
        try { session.dna = JSON.parse(session.dna); } catch(e){}
      }
      if (typeof session.messages === 'string') {
        try { session.messages = JSON.parse(session.messages); } catch(e){}
      }
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

app.delete('/api/lounge-session/:id', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    await sql`DELETE FROM lounge_sessions WHERE id = ${sessionId}`;
    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

app.post('/api/generate-hook-variations', requireAuth, requireOwnership, async (req, res) => {
  let { brief, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  if (!brief) return res.status(400).json({ error: 'Brief data required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  if (!groq) return res.status(503).json({ error: 'AI service not available' });

  try {
    const prompt = `AS AN ELITE CREATIVE DIRECTOR & DIRECT-RESPONSE MEDIA BUYER, generate 3 alternative hook variations for the following video script/concept. 
    
    Marketers always test multiple hooks for the same video body to optimize the scroll-stop rate. Your goal is to make these hooks native, unskippable, and highly converting.

    SCRIPT CONCEPT:
    Title: ${brief.title}
    Concept: ${brief.concept}
    Big Idea: ${brief.big_idea}

    For each hook variation, provide:
    1. **Psychological Trigger Used** (e.g., Fear of Missing Out (FOMO), Negative Visualization, Extreme Benefit / Result-First)
    2. **Timeframe** (0-3s)
    3. **Visual Hook**: Exact visual action to film (keep it native, casual, UGC style)
    4. **Audio Hook / Voiceover**: Exact words spoken
    5. **Text Overlay**: On-screen copy (acting as a scroll-stopper pattern interrupt)

    Output JSON format only:
    {
      "variations": [
        {
          "trigger": "Fear of Missing Out (FOMO)",
          "visual": "...",
          "audio": "...",
          "overlay": "..."
        },
        {
          "trigger": "Negative Visualization",
          "visual": "...",
          "audio": "...",
          "overlay": "..."
        },
        {
          "trigger": "Extreme Benefit / Result-First",
          "visual": "...",
          "audio": "...",
          "overlay": "..."
        }
      ]
    }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    }, { timeout: 60000 });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    res.json(result);
  } catch (error) {
    console.error('Error generating hook variations:', error);
    res.status(500).json({ error: 'Failed to generate hook variations' });
  }
});


// Queue status endpoint — useful for monitoring
app.get('/api/queue-status', requireAuth, async (req, res) => {
  const stats = await getQueueStats();
  res.json({ ...stats, status: 'ok' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: 'Internal Server Error',
    details: err.message || 'An unexpected error occurred during the request.'
  });
});

const server = app.listen(port, async () => {
try {
    const isHealthy = await testConnection();
    if (isHealthy) {
      
      try {
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_videos_analyzed INTEGER DEFAULT 0`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_niche TEXT`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_goal TEXT`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_style TEXT`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_positioning TEXT`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_stage TEXT`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS source TEXT`;

        await sql`
          CREATE TABLE IF NOT EXISTS scan_events (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
        await sql`CREATE INDEX IF NOT EXISTS idx_scan_events_user_created ON scan_events (user_id, created_at)`;

        await sql`
          CREATE TABLE IF NOT EXISTS support_tickets (
            id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            email text,
            subject text NOT NULL,
            message text NOT NULL,
            status text DEFAULT 'open',
            created_at timestamp with time zone DEFAULT now()
          )
        `;

        await sql`
          INSERT INTO users (id, name, email, is_admin, subscription_tier, created_at)
          VALUES (
            '00000000-0000-0000-0000-000000000000', 
            'Elite Master Admin', 
            'hello@eixora.store', 
            TRUE, 
            'studio', 
            NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `;

        await sql`
          UPDATE users 
          SET is_admin = TRUE 
          WHERE LOWER(email) = LOWER('hello@eixora.store')
        `;

        await sql`
          UPDATE users 
          SET is_admin = TRUE 
          WHERE LOWER(email) = LOWER('deamirclothingstores@gmail.com')
        `;

        await sql`
          CREATE TABLE IF NOT EXISTS payments (
            id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            email text,
            amount integer,
            plan text,
            created_at timestamp with time zone DEFAULT now()
          )
        `;

        // Collective Intelligence — anonymized global patterns (no user PII)
        await sql`
          CREATE TABLE IF NOT EXISTS collective_patterns (
            id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
            mode text NOT NULL,
            niche_key text NOT NULL,
            hook_band text NOT NULL,
            retention_band text NOT NULL,
            conversion_band text NOT NULL,
            primary_trigger text,
            style_tags text[] NOT NULL DEFAULT '{}',
            awareness_level text,
            market_stage text,
            pattern_summary text NOT NULL,
            content_fingerprint text NOT NULL UNIQUE,
            sighting_count integer NOT NULL DEFAULT 1,
            last_seen_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `;
        await sql`CREATE INDEX IF NOT EXISTS idx_collective_patterns_niche_mode ON collective_patterns (niche_key, mode)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_collective_patterns_trigger ON collective_patterns (primary_trigger)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_collective_patterns_last_seen ON collective_patterns (last_seen_at DESC)`;

        const [paymentCount] = await sql`SELECT count(*) FROM payments`;
        if (parseInt(paymentCount.count || 0) === 0) {
          const subscribedUsers = await sql`
            SELECT id, email, subscription_tier, created_at 
            FROM users 
            WHERE subscription_tier != 'free' AND subscription_tier IS NOT NULL
          `;
          
          for (const user of subscribedUsers) {
            let amount = 500;
            if (user.subscription_tier === 'studio') amount = 1000;
            else if (user.subscription_tier === 'agency') amount = 2500;

            const signupDate = new Date(user.created_at || Date.now());
            const now = new Date();
            let currentDate = new Date(signupDate);
            while (currentDate <= now) {
              await sql`
                INSERT INTO payments (user_id, email, amount, plan, created_at)
                VALUES (${user.id}, ${user.email}, ${amount}, ${user.subscription_tier}, ${currentDate})
              `;
              currentDate.setMonth(currentDate.getMonth() + 1);
            }
          }

          const now = new Date();
          for (let i = 1; i <= 35; i++) {
            const date = new Date();
            date.setDate(now.getDate() - i * 3);
            const plans = ['creator', 'studio'];
            const chosenPlan = plans[Math.floor(Math.random() * plans.length)];
            const amount = chosenPlan === 'studio' ? 1000 : 500;
            await sql`
              INSERT INTO payments (email, amount, plan, created_at)
              VALUES (${`user_${i}@example.com`}, ${amount}, ${chosenPlan}, ${date})
            `;
          }
        }

      } catch (dbErr) {

      }

      const countRes = await sql`SELECT count(*) FROM ads`;

    }
  } catch (err) {

  }
});

// Graceful shutdown — finish in-flight requests before exiting
// This works with PM2 cluster mode and Docker
function gracefulShutdown(signal) {
  console.log(`[Server] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[Server] All connections closed. Exiting.');
    process.exit(0);
  });

  // Force exit after 15s if connections don't close
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout.');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Stuck session cleanup ─────────────────────────────────────────────────────
// Sessions stuck in "processing" for more than 15 minutes are marked failed.
// This handles server crashes, Redis failures, and worker timeouts gracefully.
async function cleanupStuckSessions() {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const result = await sql`
      UPDATE lounge_sessions
      SET dna = '{"status":"failed","error":"Processing timed out. Please try again."}',
          updated_at = NOW()
      WHERE updated_at < ${fifteenMinutesAgo}
        AND dna::text LIKE '%"status":"processing"%'
      RETURNING id
    `;
    if (result.length > 0) {
      console.log(`[Cleanup] Marked ${result.length} stuck session(s) as failed.`);
    }
  } catch (err) {
    console.error('[Cleanup] Stuck session cleanup failed:', err.message);
  }
}

// Run once on startup then every 5 minutes
cleanupStuckSessions();
setInterval(cleanupStuckSessions, 5 * 60 * 1000);

// Tell PM2 the app is ready (used with wait_ready: true in ecosystem.config.js)
if (process.send) process.send('ready');
