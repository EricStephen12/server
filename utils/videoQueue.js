/**
 * Video processing queue using p-queue.
 * Limits concurrent heavy video jobs to prevent server crashes under load.
 * 
 * Concurrency = 3 means max 3 videos process simultaneously.
 * All other requests wait in line — no crashes, no timeouts.
 */

// p-queue v7 is ESM-only, so we use a dynamic import wrapper
let _queue = null;

async function getQueue() {
  if (_queue) return _queue;
  const { default: PQueue } = await import('p-queue');
  _queue = new PQueue({
    concurrency: 3,        // Max 3 concurrent video jobs
    timeout: 120000,       // 2 min timeout per job
    throwOnTimeout: true,  // Reject promise on timeout
  });

  _queue.on('active', () => {
    console.log(`[Queue] Job started. Size: ${_queue.size} pending, ${_queue.pending} running`);
  });

  _queue.on('idle', () => {
    console.log('[Queue] All jobs complete.');
  });

  return _queue;
}

/**
 * Add a video processing job to the queue.
 * @param {Function} fn - async function to execute
 * @returns {Promise} resolves with fn's return value
 */
async function enqueueVideoJob(fn) {
  const queue = await getQueue();
  return queue.add(fn);
}

/**
 * Get current queue stats
 */
async function getQueueStats() {
  const queue = await getQueue();
  return {
    pending: queue.size,
    running: queue.pending,
    concurrency: queue.concurrency,
  };
}

module.exports = { enqueueVideoJob, getQueueStats };
