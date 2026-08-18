const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { analyzeVideoFrames } = require('./visionAnalyzer');
const { generateProductIntel } = require('./productIntel');
const { extractFramesBackend, extractAudioFromVideo } = require('./videoExtractor');
const { transcribeAudio } = require('./audioTranscriber');
const { sql } = require('../db/index');

let connection = null;
let analyzeQueue = null;
let analyzeWorker = null;

if (process.env.REDIS_URL) {
  // Shared Redis connection for BullMQ
  connection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null
  });

  // Queue setup
  analyzeQueue = new Queue('analyze-video-queue', { connection });
}

async function processAnalysisJob(data) {
  const { sessionId, userId, originalUrl, localFilePath, niche, mode, maxFrames, maxLength, plan } = data;
  console.log(`[Worker] Started processing analysis job for session ${sessionId}...`);

  try {
    // 1. Extract frames — handle both URL-based and local file uploads
    console.log(`[Worker] Extracting up to ${maxFrames} frames...`);
    const sourceUrl = localFilePath || originalUrl;
    const { frames, duration } = await extractFramesBackend(sourceUrl, maxFrames);
    
    // 2. Validate duration limits
    if (duration > maxLength) {
      throw new Error(`Video is too long (${Math.round(duration)}s). Maximum allowed is ${maxLength}s.`);
    }

    // 3. Run the actual analysis — route model by user's plan and mode
    let analysis;
    if (mode === 'product-intel') {
      // For product intel, also transcribe audio — spoken words disambiguate visually similar products
      let transcript = '';
      const videoFilePath = localFilePath || null;

      if (videoFilePath) {
        // Uploaded file — extract audio directly
        try {
          console.log('[Worker] Extracting audio for product intel transcription...');
          const audioPath = await extractAudioFromVideo(videoFilePath);
          transcript = await transcribeAudio(audioPath);
          console.log(`[Worker] Transcript (${transcript.length} chars) ready for product intel`);
        } catch (audioErr) {
          console.warn('[Worker] Audio transcription failed (non-fatal):', audioErr.message);
        }
      } else {
        // URL-based — video was already deleted after frame extraction.
        // Re-download just the audio track via yt-dlp (much faster than full video).
        try {
          const fs = require('fs');
          const path = require('path');
          const crypto = require('crypto');
          const { execFile } = require('child_process');
          const { resolveYtdlpPath } = require('./ytdlpPath');
          const YTDLP_PATH = resolveYtdlpPath();
          const tmpAudioPath = path.join(__dirname, '../uploads/tmp', `audio_${crypto.randomBytes(6).toString('hex')}.mp3`);

          console.log('[Worker] Downloading audio-only for product intel transcription...');
          await new Promise((resolve, reject) => {
            execFile(YTDLP_PATH, [
              originalUrl,
              '--output', tmpAudioPath,
              '--format', 'bestaudio[ext=m4a]/bestaudio/best',
              '--extract-audio',
              '--audio-format', 'mp3',
              '--audio-quality', '5',          // Low quality, speech only
              '--no-playlist',
              '--socket-timeout', '20',
              '--postprocessor-args', 'ffmpeg:-t 120',  // Cap at 2 min
              '-q',
            ], { timeout: 60000 }, (err, stdout, stderr) => {
              if (err) reject(new Error(`yt-dlp audio failed: ${stderr || err.message}`));
              else resolve();
            });
          });

          if (fs.existsSync(tmpAudioPath)) {
            transcript = await transcribeAudio(tmpAudioPath);
            console.log(`[Worker] Transcript (${transcript.length} chars) ready for product intel`);
          }
        } catch (audioErr) {
          console.warn('[Worker] Audio-only download/transcription failed (non-fatal):', audioErr.message);
        }
      }

      // Fetch user personalization profile from onboarding
      let userProfile = null;
      if (userId) {
        try {
          const [u] = await sql`SELECT brand_stage, brand_positioning, brand_niche, brand_style, primary_goal FROM users WHERE id = ${userId}`;
          if (u) userProfile = u;
        } catch (uErr) {
          console.warn('[Worker] User profile query failed (non-fatal):', uErr.message);
        }
      }

      analysis = await generateProductIntel(frames, originalUrl, plan || 'free', transcript, userProfile);
    } else {
      // Fetch user personalization profile from onboarding
      let userProfile = null;
      if (userId) {
        try {
          const [u] = await sql`SELECT brand_stage, brand_positioning, brand_niche, brand_style, primary_goal FROM users WHERE id = ${userId}`;
          if (u) userProfile = u;
        } catch (uErr) {
          console.warn('[Worker] User profile query failed (non-fatal):', uErr.message);
        }
      }

      analysis = await analyzeVideoFrames(frames, 'Mobile Analysis', '', null, mode || 'ad', plan || 'free', userProfile);
    }
    
    // Update all-time total counter (scan_events is already inserted upfront to prevent race conditions)
    if (userId) {
      try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${userId}`;
      } catch (err) {
        console.error('[Worker] Failed to update user stats:', err);
      }
    }

    try {
      await sql`
        INSERT INTO ad_benchmarks (user_id, video_url, niche, hook_power, retention_score, conversion_trigger,
          awareness_level, style, primary_trigger, transcript_length)
        VALUES (${userId || null}, ${originalUrl || null}, ${analysis.niche || niche || 'General'},
          ${analysis.metrics?.hook_power || 0}, ${analysis.metrics?.retention_score || 0},
          ${analysis.metrics?.conversion_trigger || 0}, ${analysis.awareness_level || null},
          ${analysis.vibe_assessment?.style || null}, ${analysis.psychology_breakdown?.primary_trigger || null},
          0)
      `;
    } catch (e) {
      console.error('[Worker] Failed to insert ad_benchmarks:', e);
    }

    // Append status and mode to DNA so frontend knows it is complete
    analysis.status = 'completed';
    analysis.mode = mode || 'ad';

    // Ephemeral Director Frames — timestamp metadata only (no image blobs)
    try {
      const { attachVisualTriggers } = require('./visualTriggers');
      attachVisualTriggers(analysis, frames || []);
      // Session-only frame previews for Voice Lounge (already extracted at analyze time)
      analysis.frames = (frames || []).map((f) => ({
        timestamp: f.timestamp,
        phase: f.phase,
        mimeType: f.mimeType || 'image/jpeg',
        base64: f.base64,
      }));
    } catch (trigErr) {
      console.warn('[VisualTriggers] attach failed (non-fatal):', trigErr.message);
    }

    await sql`
        UPDATE lounge_sessions
        SET dna = ${JSON.stringify(analysis)}, updated_at = NOW()
        WHERE id = ${sessionId}
    `;
    console.log(`[Worker] Successfully finished job for session ${sessionId}`);

    // Collective Intelligence — anonymized pattern upsert (never fails the user job)
    try {
      const { upsertPattern } = require('./collectiveMemory');
      const result = await upsertPattern(analysis);
      if (result.ok) {
        console.log(`[CollectiveMemory] upserted pattern ${result.id} (sightings=${result.sightings})`);
      }
    } catch (memErr) {
      console.warn('[CollectiveMemory] post-analyze hook failed (non-fatal):', memErr.message);
    }

  } catch(analyzeErr) {
    console.error(`[Worker] Mobile Analysis Error for session ${sessionId}:`, analyzeErr);
    const failedDna = { status: 'failed', error: analyzeErr.message || 'Unknown processing error' };
    await sql`
        UPDATE lounge_sessions
        SET dna = ${JSON.stringify(failedDna)}, updated_at = NOW()
        WHERE id = ${sessionId}
    `;
    throw analyzeErr; // Mark job as failed in BullMQ dashboard
  } finally {
    // Clean up the uploaded file after processing (success or failure)
    // URL-based scans are cleaned up inside extractFramesBackend already
    if (localFilePath) {
      try {
        const fs = require('fs');
        if (fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
          console.log(`[Worker] Cleaned up uploaded file: ${localFilePath}`);
        }
      } catch (cleanupErr) {
        console.error('[Worker] Failed to clean up uploaded file:', cleanupErr.message);
      }
    }
  }
}

if (connection) {
  // Worker setup — limit concurrency to prevent server OOM under load.
  // 3 concurrent jobs = max ~3 ffmpeg processes at once.
  // Increase to 5 on a dedicated worker server with 2GB+ RAM.
  analyzeWorker = new Worker('analyze-video-queue', async job => {
    await processAnalysisJob(job.data);
  }, { connection, concurrency: 3 });

  analyzeWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed with error ${err.message}`);
  });
}

module.exports = {
  analyzeQueue,
  analyzeWorker,
  processAnalysisJob
};

// ── Standalone worker mode ────────────────────────────────────────────────────
// When run directly (node utils/queue.js), keep the process alive and log ready.
if (require.main === module) {
  if (!process.env.REDIS_URL) {
    console.error('[Worker] REDIS_URL is not set. Worker cannot start without Redis.');
    process.exit(1);
  }
  console.log('[Worker] Eixora video analysis worker started. Waiting for jobs...');

  // Keep process alive — BullMQ worker is event-driven
  process.on('SIGTERM', async () => {
    console.log('[Worker] SIGTERM received, closing worker...');
    if (analyzeWorker) await analyzeWorker.close();
    if (connection) await connection.quit();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[Worker] SIGINT received, closing worker...');
    if (analyzeWorker) await analyzeWorker.close();
    if (connection) await connection.quit();
    process.exit(0);
  });
}
