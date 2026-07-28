const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('@ffprobe-installer/ffprobe');
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic.path) ffmpeg.setFfprobePath(ffprobeStatic.path);
const crypto = require('crypto');

// yt-dlp path — bundled exe on Windows, system binary on Linux (Railway)
const YTDLP_PATH = process.platform === 'win32'
  ? path.join(__dirname, '../yt-dlp.exe')
  : 'yt-dlp'; // must be installed on the Railway server: apt-get install yt-dlp

/**
 * Resolve a social video URL to a direct MP4 stream URL.
 * Tries tikwm first (fast, free), falls back to yt-dlp if tikwm fails.
 */
async function resolveVideoUrl(url, videoPath) {
  const isTikTok   = url.includes('tiktok.com');
  const isReels    = url.includes('instagram.com');
  const isShorts   = url.includes('youtube.com/shorts') || url.includes('youtu.be');
  const isFacebook = url.includes('facebook.com') || url.includes('fb.watch');

  // ── tikwm for TikTok (fastest) ────────────────────────────────────────────
  if (isTikTok) {
    try {
      const cleanUrl = url.split('?')[0];
      const res = await axios.post('https://tikwm.com/api/',
        new URLSearchParams({ url: cleanUrl, hd: '1' }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
      const play = res.data?.data?.hdplay || res.data?.data?.play;
      if (play) {
        console.log('[Resolver] tikwm resolved TikTok URL');
        return { type: 'url', value: play };
      }
      console.warn('[Resolver] tikwm returned no URL, falling back to yt-dlp');
    } catch (err) {
      console.warn('[Resolver] tikwm failed:', err.message, '— falling back to yt-dlp');
    }
  }

  // ── yt-dlp fallback for all platforms ─────────────────────────────────────
  // Downloads directly to videoPath and returns the file path
  try {
    await new Promise((resolve, reject) => {
      execFile(YTDLP_PATH, [
        url,
        '--output', videoPath,
        '--format', 'mp4/best[ext=mp4]/best',
        '--no-playlist',
        '--socket-timeout', '30',
        '--retries', '3',
        '-q', // quiet
      ], { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
        else resolve();
      });
    });
    console.log('[Resolver] yt-dlp downloaded video successfully');
    return { type: 'file', value: videoPath };
  } catch (err) {
    throw new Error(`All resolvers failed for ${url}: ${err.message}`);
  }
}

/**
 * Download a remote video, extract keyframes, and clean up.
 * @param {string} url - The video URL to download
 * @param {number} maxFrames - Maximum frames to extract based on user tier
 * @returns {Promise<{frames: Array, duration: number}>}
 */
async function extractFramesBackend(url, maxFrames = 5) {
  const tmpDir = path.join(__dirname, '../uploads/tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const videoPath = path.join(tmpDir, `video_${fileId}.mp4`);
  const framesDir = path.join(tmpDir, `frames_${fileId}`);
  fs.mkdirSync(framesDir, { recursive: true });

  // Track whether we need to download or already have the file
  let videoReady = false;

  // Handle local file paths (manual uploads)
  if (!url.startsWith('http') && fs.existsSync(url)) {
    // Already a local file — copy to our tmp path for consistent cleanup
    fs.copyFileSync(url, videoPath);
    videoReady = true;
  }

  try {
    if (!videoReady) {
      // Resolve and download the video
      const resolved = await resolveVideoUrl(url, videoPath);

      if (resolved.type === 'url') {
        // tikwm gave us a direct URL — download it
        const dlRes = await axios({
          method: 'get',
          url: resolved.value,
          responseType: 'stream',
          timeout: 90000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.tiktok.com/',
          }
        });
        const writer = fs.createWriteStream(videoPath);
        dlRes.data.pipe(writer);
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
      }
      // If resolved.type === 'file', yt-dlp already wrote to videoPath
    }

    // 2. Get duration
    console.log(`[Extractor] Running ffprobe on ${videoPath}...`);
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, data) => err ? reject(err) : resolve(data));
    });
    console.log(`[Extractor] ffprobe complete.`);

    let duration = metadata.format?.duration || 0;
    if (duration <= 0) {
      throw new Error("Could not determine video duration");
    }

    // 3. Extract frames
    const timestamps = [];
    const step = duration / maxFrames;
    for (let i = 0; i < maxFrames; i++) {
      timestamps.push(Number((i * step).toFixed(2)));
    }

    console.log(`[Extractor] Starting frame extraction loop for timestamps:`, timestamps);
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      console.log(`[Extractor] Extracting frame at ${t}s...`);
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .seekInput(t)
          .frames(1)
          .size('640x?')
          .outputOptions(['-threads', '1', '-q:v', '2'])
          .output(path.join(framesDir, `frame-at-${t}-seconds.jpg`))
          .on('end', resolve)
          .on('error', (err, stdout, stderr) => {
            console.error(`ffmpeg error at ${t}s:`, stderr);
            reject(err);
          })
          .run();
      });
    }

    // 4. Read frames into Base64 format
    const frames = [];
    const files = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));

    files.sort((a, b) => {
      const timeA = parseFloat(a.match(/frame-at-([\d.]+)-seconds/)?.[1] || '0');
      const timeB = parseFloat(b.match(/frame-at-([\d.]+)-seconds/)?.[1] || '0');
      return timeA - timeB;
    });

    for (const file of files) {
      const filePath = path.join(framesDir, file);
      const timestamp = parseFloat(file.match(/frame-at-([\d.]+)-seconds/)?.[1] || '0');
      const base64 = fs.readFileSync(filePath).toString('base64');

      let phase = 'middle';
      if (timestamp < 3) phase = 'hook';
      else if (timestamp > duration - 5) phase = 'cta';
      else if (timestamp < duration * 0.4) phase = 'problem_setup';
      else phase = 'solution';

      frames.push({ timestamp, base64, mimeType: 'image/jpeg', phase });
    }

    return { frames, duration };

  } catch (err) {
    throw new Error(`Failed to extract frames: ${err.message}`);
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(framesDir)) {
        fs.readdirSync(framesDir).forEach(f => fs.unlinkSync(path.join(framesDir, f)));
        fs.rmdirSync(framesDir);
      }
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
    }
  }
}

module.exports = { extractFramesBackend };

/**
 * Extract audio from a video file as an MP3 for Whisper transcription.
 * Used specifically for Product Intelligence mode to disambiguate similar products.
 * @param {string} videoPath - Path to the local video file
 * @returns {Promise<string>} - Path to the extracted audio file
 */
async function extractAudioFromVideo(videoPath) {
  const audioPath = videoPath.replace(/\.[^/.]+$/, '') + '_audio.mp3';

  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('64k')       // Low bitrate — speech only, save bandwidth
      .audioChannels(1)           // Mono — sufficient for transcription
      .audioFrequency(16000)      // 16kHz — Whisper's native sample rate
      .duration(120)              // Cap at 2 min — enough for product ID
      .output(audioPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('[AudioExtractor] ffmpeg error:', err.message);
        reject(err);
      })
      .run();
  });

  return audioPath;
}

module.exports = { extractFramesBackend, extractAudioFromVideo };
