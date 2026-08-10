const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('@ffprobe-installer/ffprobe');
const fs = require('fs');
const path = require('path');

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

/**
 * Normalize browser mic clips to 16 kHz mono WAV for Whisper accuracy.
 * @param {string} inputPath
 * @returns {Promise<string>} path to normalized wav (may equal input if already wav)
 */
async function normalizeAudioForWhisper(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  const outPath = inputPath.replace(/\.[^.]+$/, '') + '_whisper.wav';

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .audioFilters('highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11')
      .output(outPath)
      .on('end', resolve)
      .on('error', (err) => reject(err))
      .run();
  });

  if (ext !== '.wav' && fs.existsSync(inputPath)) {
    try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
  }
  return outPath;
}

module.exports = { normalizeAudioForWhisper };
