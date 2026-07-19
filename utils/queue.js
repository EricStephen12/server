const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { analyzeVideoFrames } = require('./visionAnalyzer');
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
  const { sessionId, userId, originalUrl, niche, mode, maxFrames, maxLength, plan } = data;
  console.log(`[Worker] Started processing analysis job for session ${sessionId}...`);

  try {
    // 1. Download and extract frames on the backend
    console.log(`[Worker] Extracting up to ${maxFrames} frames from ${originalUrl}...`);
    const { frames, duration } = await extractFramesBackend(originalUrl, maxFrames);
    
    // 2. Validate duration limits
    if (duration > maxLength) {
      throw new Error(`Video is too long (${Math.round(duration)}s). Maximum allowed is ${maxLength}s.`);
    }

    // 3. Run the actual analysis — route model by user's plan
    const analysis = await analyzeVideoFrames(frames, 'Mobile Analysis', '', null, mode || 'ad', plan || 'free');
    
    // Update stats
    if (userId) {
      try {
        await sql`UPDATE users SET total_videos_analyzed = total_videos_analyzed + 1 WHERE id = ${userId}`;
        await sql`INSERT INTO scan_events (user_id, created_at) VALUES (${userId}, NOW())`;
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

    // Append status to DNA so frontend knows it is complete
    analysis.status = 'completed';

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
  }
}

if (connection) {
  // Worker setup
  analyzeWorker = new Worker('analyze-video-queue', async job => {
    await processAnalysisJob(job.data);
  }, { connection });

  analyzeWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed with error ${err.message}`);
  });
}

module.exports = {
  analyzeQueue,
  analyzeWorker,
  processAnalysisJob
};
