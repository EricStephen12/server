const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('@ffprobe-installer/ffprobe');
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic.path) ffmpeg.setFfprobePath(ffprobeStatic.path);
const crypto = require('crypto');

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

  try {
    let finalUrl = url;

    // Resolve TikTok URLs to raw MP4 streams using tikwm
    if (url.includes('tiktok.com')) {
      const cleanUrl = url.split('?')[0];
      const tikwmRes = await axios.post('https://tikwm.com/api/',
        new URLSearchParams({ url: cleanUrl }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      if (tikwmRes.data?.data?.play) {
         finalUrl = tikwmRes.data.data.play;
      } else {
         throw new Error('Failed to resolve TikTok video stream');
      }
    }

    // 1. Download video
    const dlRes = await axios({
      method: 'get',
      url: finalUrl,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });

    const writer = fs.createWriteStream(videoPath);
    dlRes.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // 2. Get duration
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, data) => err ? reject(err) : resolve(data));
    });
    
    let duration = metadata.format?.duration || 0;
    if (duration <= 0) {
      throw new Error("Could not determine video duration");
    }

    // 3. Extract frames
    const timestamps = [];
    const step = duration / maxFrames;
    for (let i = 0; i < maxFrames; i++) {
      let t = i * step;
      timestamps.push(Number(t.toFixed(2))); // e.g., 0.00, 2.50
    }

    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .on('end', resolve)
        .on('error', reject)
        .screenshots({
          timestamps: timestamps,
          filename: 'frame-at-%s-seconds.jpg',
          folder: framesDir,
          size: '640x?', // Scale down for faster processing and lower memory footprint
        });
    });

    // 4. Read frames into Base64 format
    const frames = [];
    const files = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));
    
    // Sort files logically by parsing the second value
    files.sort((a, b) => {
      const matchA = a.match(/frame-at-([\d.]+)-seconds/);
      const matchB = b.match(/frame-at-([\d.]+)-seconds/);
      const timeA = matchA ? parseFloat(matchA[1]) : 0;
      const timeB = matchB ? parseFloat(matchB[1]) : 0;
      return timeA - timeB;
    });

    for (const file of files) {
      const filePath = path.join(framesDir, file);
      const match = file.match(/frame-at-([\d.]+)-seconds/);
      const timestamp = match ? parseFloat(match[1]) : 0;
      
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      
      let phase = 'middle';
      if (timestamp < 3) phase = 'hook';
      else if (timestamp > duration - 5) phase = 'cta';
      else if (timestamp < duration * 0.4) phase = 'problem_setup';
      else phase = 'solution';

      frames.push({
        timestamp,
        base64,
        mimeType: 'image/jpeg',
        phase
      });
    }

    return { frames, duration };

  } catch (err) {
    throw new Error(`Failed to extract frames: ${err.message}`);
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(framesDir)) {
        const files = fs.readdirSync(framesDir);
        for (const file of files) {
          fs.unlinkSync(path.join(framesDir, file));
        }
        fs.rmdirSync(framesDir);
      }
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
    }
  }
}

module.exports = { extractFramesBackend };
