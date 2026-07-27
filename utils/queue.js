const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { analyzeVideoFrames } = require('./visionAnalyzer');
const { generateProductIntel } = require('./productIntel');
const { extractFramesBackend } = require('./videoExtractor');
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
      analysis = await generateProductIntel(frames, originalUrl, plan || 'free');
    } else {
      analysis = await analyzeVideoFrames(frames, 'Mobile Analysis', '', null, mode || 'ad', plan || 'free');
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

    await sql`
        UPDATE lounge_sessions
        SET dna = ${JSON.stringify(analysis)}, updated_at = NOW()
        WHERE id = ${sessionId}
    `;
    console.log(`[Worker] Successfully finished job for session ${sessionId}`);

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
