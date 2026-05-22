const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const Groq = require('groq-sdk');
const multer = require('multer');
const { extractFrames } = require('./utils/frameExtractor');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');
const { transcribeAudio } = require('./utils/audioTranscriber');
const { identifyMusic } = require('./utils/musicRecognizer');
const { sql, testConnection } = require('./db/index');
const prisma = require('./db/prisma');
const adminRouter = require('./routes/admin');
const adminAuthRouter = require('./routes/adminAuth');
const supportRouter = require('./routes/support');

const polarWebhooks = require('./routes/polar');
const userRouter = require('./routes/user');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();


process.on('unhandledRejection', (reason, promise) => {

});

process.on('uncaughtException', (err) => {


});

const app = express();
const port = process.env.PORT || 4000;

app.set('trust proxy', 1);

const upload = multer({ dest: 'uploads/' });

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  (process.env.FRONTEND_URL || '').replace(/\/$/, ''),
  (process.env.CLIENT_URL || '').replace(/\/$/, ''),
  'https://eixora.vercel.app',
  'https://client-phi-ivory.vercel.app'
].filter(Boolean);

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

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Limit each IP to 100 requests per 15 mins
  message: { error: 'Too many requests' }
});
app.use('/api/', globalLimiter);


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
  res.json({
    status: 'ok',
    timestamp: new Date(),
    message: 'Server is running.',
    groq_configured: !!groq
  });
});

async function resolveInternalId(id, clerkInfo = null) {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;

  if (id === '00000000-0000-0000-0000-000000000000') return id;

  try {
    let [user] = await sql`SELECT id FROM users WHERE clerk_id = ${id}`;
    if (user) return user.id;

const email = clerkInfo?.email || null;
    const name = clerkInfo?.name || null;

const [newUser] = await sql`
      INSERT INTO users (clerk_id, email, name, subscription_tier, created_at)
      VALUES (${id}, ${email}, ${name}, 'free', ${new Date()})
      ON CONFLICT (email) DO UPDATE SET clerk_id = ${id}
      RETURNING id
    `;
    return newUser.id;
  } catch (err) {

    return null;
  }
}

app.use('/api/admin/auth', adminAuthRouter);
app.use('/api/admin', adminRouter);
app.use('/api/support', supportRouter);
app.use('/api', userRouter);

app.get('/api/debug', async (req, res) => {
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

app.post('/api/save-to-vault', async (req, res) => {
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

app.get('/api/user-ads', async (req, res) => {
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

    const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
    const tier = user?.subscription_tier || 'free';

    const limits = {
      free: 3,
      creator: 30,
      studio: 250,
      agency: 250 // Backward compatibility
    };

    const userLimit = limits[tier] || 3;

    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    if (type === 'scan') {
      const [{ count }] = await sql`
        SELECT count(*)::int FROM lounge_sessions 
        WHERE user_id = ${userId} AND updated_at > ${oneMonthAgo}
      `;
      return { allowed: count < userLimit, count, limit: userLimit };
    }

    if (type === 'script') {
      const [{ count }] = await sql`
        SELECT count(*)::int FROM scripts 
        WHERE user_id = ${userId} AND created_at > ${oneMonthAgo}
      `;
      return { allowed: count < userLimit, count, limit: userLimit };
    }

    return { allowed: true };
  } catch (err) {

    return { allowed: true }; // Allow on error to avoid blocking users
  }
}

app.post('/api/batch-analyze', async (req, res) => {
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
  if (tier !== 'agency' && tier !== 'studio') {
    return res.status(403).json({
      error: 'Agency Access Required',
      details: 'Batch Analysis is exclusive to the Agency Plan. Upgrade to unlock bulk DNA extraction.'
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

app.post('/api/export-report', async (req, res) => {
  let { analysis, videoUrl, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User not found' });

const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
  const tier = user?.subscription_tier || 'free';
  if (tier !== 'agency' && tier !== 'studio') {
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

    res.status(500).json({ error: 'Failed to generate report' });
  }
});



app.post('/api/analyze-video', upload.single('video'), async (req, res) => {
  let userId = req.body.userId;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

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

    const { frames, audioPath } = await extractFrames(req.file.path);

    if (!frames || frames.length === 0) {
      throw new Error('No frames could be extracted from this video.');
    }

    let transcript = "";
    let music = null;
    if (audioPath) {
      try {
        music = await identifyMusic(audioPath);
      } catch (err) {
        console.error('Music identification failed:', err.message);
      }
      try {
        transcript = await transcribeAudio(audioPath);
      } catch (err) {
        console.error('Transcription failed:', err.message);
      }
    }

const analysis = await analyzeVideoFrames(frames, 'Uploaded Draft Analysis', transcript, music);

if (userId) {
      try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${userId}`;
      } catch (err) {

      }
    }

    res.json({
      success: true,
      analysis,
      framesAnalyzed: frames.length,
      hasAudio: !!transcript
    });

  } catch (error) {

    res.status(500).json({
      error: 'Video audit failed',
      details: error.message
    });
  }
});

app.post('/api/analyze-video-url', async (req, res) => {
  let { videoUrl, userId } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'Video URL required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Groq API not configured' });
  }

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

    const { frames, audioPath } = await extractFrames(videoUrl);

    if (!frames || frames.length === 0) {
      throw new Error('No frames could be extracted from this URL.');
    }

let transcript = "";
let music = null;
    if (audioPath) {
      try {
        music = await identifyMusic(audioPath);
      } catch (err) {
        console.error('Music identification failed:', err.message);
      }
      try {
        transcript = await transcribeAudio(audioPath);

      } catch (err) {

      }
    }

const analysis = await analyzeVideoFrames(frames, 'URL Analysis', transcript, music);

if (userId) {
      try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${userId}`;
      } catch (err) {

      }
    }

    res.json({
      success: true,
      analysis,
      framesAnalyzed: frames.length,
      hasAudio: !!transcript
    });

  } catch (error) {

    res.status(500).json({
      error: 'URL Video audit failed',
      details: error.message
    });
  }
});

app.post('/api/generate-script', async (req, res) => {
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

app.post('/api/script-strategy-questions', async (req, res) => {
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

app.post('/api/creative-director-chat', async (req, res) => {
  let { messages, dna, isRoastMode, userId } = req.body;

  if (!groq) return res.status(503).json({ error: 'AI service not available' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

  try {
    const isIntro = !messages || messages.length === 0;

    const systemPrompt = `You are an Elite Creative Director & Media Buyer. 
    You don't talk like a robot. You talk like the smartest friend I have who spends $50k/day on TikTok ads. 
    
    YOUR VOICE:
    - Casual, direct, confident. 
    - Use media buyer slang: "stopping the scroll," "hook rate," "pattern interrupt," "hold time," "AOV," "whitelisting."
    - No fluff. No "authenticity" talk. Tell me why people's thumbs STOP.
    
    YOUR TASK:
    You have just PERSONALLY watched this video. You've deconstructed the frames. You know why it's winning (or why it's trash).
    
    ${isRoastMode ? 'YOUR PERSONA: ROAST MODE. Be ruthless. If the ad sucks, say it. If the hook is weak, tell me I\'m wasting money.' : 'YOUR PERSONA: Creative Director. Direct, high-stakes, elite.'}

    THE DECONSTRUCTED DNA:
    - **Niche**: ${dna.niche || 'General'}
    - **The Big Idea**: "${dna.big_idea || 'Not identified'}"
    - **The Secret Sauce**: "${dna.the_secret_sauce || 'Not identified'}"
    - **Visual Hook**: ${dna.hook_analysis?.critique || 'No visual hook data'}
    - **Full Transcript**: "${dna.transcript || 'No transcript data'}"
    - **Pacing**: ${dna.pacing_analysis?.critique || 'Standard pacing'}
    
    PERFORMANCE SCORES:
    - **Hook**: ${dna.metrics?.hook_power || 'N/A'}/10
    - **Retention**: ${dna.metrics?.retention_score || 'N/A'}/10
    - **CTA**: ${dna.metrics?.conversion_trigger || 'N/A'}/10

    THE RULES:
    1. **ACTION OVER ANALYSIS**: Don't just analyze. Tell me what to film. 
    2. **PUSH BACK**: If the user's product doesn't fit the viral angle, TELL THEM. "This won't work for a health supplement, but we can steal the transition style."
    3. **THE ANCHOR FIRST**: If you don't know what the user is selling yet, YOU MUST ASK.
    4. **REMEMBER EVERYTHING**: Every piece of context the user gives (product, audience) is now permanent for this session. Use it.

    ${isIntro ? `
    INSTRUCTION: This is the opening memo. 
    
    1. **The Verdict**: 1 sharp sentence on the video's potential. "This hook is a 9/10 scroll-stopper."
    2. **Why It Works**: Explain it like a human. "This works because it makes you feel like you're missing out on a secret."
    3. **The Question**: Before I give you the strategy, I need the context.
    
    End exactly with: "Before I break this down — what's your product and who are you selling to?"
    ` : 'Bridge the DNA to their product. If they sell [Product], tell them exactly how to remix [Hook] for it. Always end with a suggestion for a script or hook variation.'}
    `;

    let completion;
    const MAX_RETRIES = 3;
    const sanitizedMessages = (messages || []).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {

        completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            ...sanitizedMessages
          ],
          model: "llama-3.3-70b-versatile",
          temperature: 0.7,
        }, { timeout: 60000 });
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

    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/save-lounge-session', async (req, res) => {
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
    res.json(result);
  } catch (error) {

    res.status(500).json({ error: 'Failed to save session' });
  }
});

app.get('/api/user-sessions', async (req, res) => {
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

app.get('/api/lounge-session/:id', async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const [session] = await sql`SELECT * FROM lounge_sessions WHERE id = ${sessionId}`;

    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {

    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

app.delete('/api/lounge-session/:id', async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    await sql`DELETE FROM lounge_sessions WHERE id = ${sessionId}`;
    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {

    res.status(500).json({ error: 'Failed to delete session' });
  }
});


app.post('/api/generate-final-script', async (req, res) => {
  let { messages, dna, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  userId = await resolveInternalId(userId);
  if (!userId) return res.status(404).json({ error: 'User resolution failed' });

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

app.post('/api/team/invite', async (req, res) => {
  const { email, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  const [user] = await sql`SELECT subscription_tier FROM users WHERE id = ${userId}`;
  const tier = user?.subscription_tier || 'free';
  if (tier !== 'agency') {
    return res.status(403).json({
      error: 'Agency Access Required',
      details: 'Team Members is an Agency plan feature. Upgrade to collaborate with your team.'
    });
  }

  try {

    const memberEmail = email; // For context

    const [{ count }] = await sql`SELECT count(*)::int FROM team_members WHERE owner_id = ${userId}`;
    if (count >= 5) {
      return res.status(400).json({ error: 'Maximum 5 team members allowed on the Agency plan.' });
    }

const [existing] = await sql`SELECT id FROM team_members WHERE owner_id = ${userId} AND member_email = ${email}`;
    if (existing) {
      return res.status(400).json({ error: 'This email is already a team member.' });
    }

const [existingUser] = await sql`SELECT id FROM users WHERE email = ${email}`;

    await sql`
      INSERT INTO team_members (owner_id, member_email, role)
      VALUES (${userId}, ${email}, 'member')
    `;

    res.json({ success: true, message: `Invite sent to ${email}` });
  } catch (err) {

    res.status(500).json({ error: 'Failed to invite team member' });
  }
});

app.get('/api/team/list', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  const ownerId = await resolveInternalId(userId);
  if (!ownerId) return res.status(404).json({ error: 'User not found' });

  try {
    const members = await sql`SELECT * FROM team_members WHERE owner_id = ${ownerId} ORDER BY created_at DESC`;
    res.json({ members });
  } catch (err) {

    res.status(500).json({ error: 'Failed to list team' });
  }
});

app.delete('/api/team/remove/:memberId', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  try {
    const { memberId } = req.params;

const [member] = await sql`SELECT * FROM team_members WHERE id = ${memberId} AND owner_id = ${userId}`;
    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }

if (member.member_user_id) {
      await sql`UPDATE users SET subscription_tier = 'free' WHERE id = ${member.member_user_id}`;
    }

    await sql`DELETE FROM team_members WHERE id = ${memberId} AND owner_id = ${req.user.id}`;

res.json({ success: true });

  } catch (error) {

    res.status(500).json({ error: 'Failed to remove team member' });
  }
});

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

if (!email) {

      return res.status(200).json({ status: 'ignored', reason: 'no email' });
    }

const [user] = await sql`SELECT id, subscription_tier FROM users WHERE email = ${email}`;

    if (!user) {

      return res.status(200).json({ status: 'ignored', reason: 'user not found' });
    }

const isRefunded = refunded === 'true' || refunded === true;
    const isCancelled = req.body.subscription_cancelled_at || req.body.is_subscription_ended === 'true' || req.body.is_subscription_ended === true;

    if (isRefunded || isCancelled) {

      await sql`
        UPDATE users
        SET subscription_tier = 'free',
            subscription_status = ${isRefunded ? 'refunded' : 'cancelled'},
            updated_at = NOW()
        WHERE id = ${user.id}
      `;
      return res.status(200).json({ status: 'downgraded', reason: isRefunded ? 'refund' : 'cancel' });
    }

let subscriptionTier = 'founding'; // default to founding
    const nameLower = (product_name || '').toLowerCase();
    const permalinkLower = (product_permalink || '').toLowerCase();

    if (nameLower.includes('agency') || permalinkLower.includes('agency')) {
      subscriptionTier = 'agency';
    }

await sql`
      UPDATE users
      SET subscription_tier = ${subscriptionTier},
          subscription_status = 'active',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;

return res.status(200).json({ status: 'success', tier: subscriptionTier });

  } catch (err) {

    return res.status(200).json({ status: 'error', message: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: 'Internal Server Error',
    details: err.message || 'An unexpected error occurred during the request.'
  });
});

app.listen(port, async () => {

try {
    const isHealthy = await testConnection();
    if (isHealthy) {
      
      try {
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_videos_analyzed INTEGER DEFAULT 0`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE`;

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
            'admin@eixora.ai', 
            TRUE, 
            'agency', 
            NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `;

      } catch (dbErr) {

      }

      const countRes = await sql`SELECT count(*) FROM ads`;

    }
  } catch (err) {

  }
});
