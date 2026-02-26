const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const axios = require('axios');

// Try to find ffmpeg path
try {
    const ffmpegPath = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
    if (ffmpegPath) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        console.log('✅ ffmpeg found at:', ffmpegPath);
    }
} catch (error) {
    const commonPaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
    for (const testPath of commonPaths) {
        if (fs.existsSync(testPath)) {
            ffmpeg.setFfmpegPath(testPath);
            console.log('✅ ffmpeg found at:', testPath);
            break;
        }
    }
}

/**
 * Downloads a file from a URL using axios (handles redirects, large files).
 */
async function downloadDirect(url, destPath) {
    const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 60000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

/**
 * Resolve a TikTok URL to a direct download link using tikwm.com API.
 * This is the same backend that SnapTik and similar tools use.
 * Works from any server (Render, Railway, etc.) — no IP blocking issues.
 */
async function resolveTikTokUrl(url) {
    console.log('⚡ Resolving TikTok video via tikwm API...');

    // Extract clean URL (strip tracking params)
    const cleanUrl = url.split('?')[0];

    const response = await axios({
        method: 'post',
        url: 'https://tikwm.com/api/',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        data: `url=${encodeURIComponent(cleanUrl)}&hd=1`
    });

    const data = response.data;

    if (data?.code === 0 && data?.data) {
        // Prefer HD play URL, fallback to regular play, then download URL
        const videoUrl = data.data.hdplay || data.data.play || data.data.wmplay;
        if (videoUrl) {
            console.log('✅ tikwm resolved video URL successfully');
            return videoUrl;
        }
    }

    throw new Error('tikwm API failed to resolve TikTok video URL.');
}

/**
 * Find the yt-dlp binary path — checks local project binary first, then system.
 * Used as a LOCAL FALLBACK only (doesn't work on cloud servers like Render).
 */
function getYtDlpPath() {
    const localBin = path.join(__dirname, '../yt-dlp');
    if (fs.existsSync(localBin)) return localBin;
    try {
        return execSync('which yt-dlp', { encoding: 'utf-8' }).trim();
    } catch (_) { }
    return null;
}

/**
 * Download a video using yt-dlp (local fallback).
 */
async function downloadWithYtDlp(url, destPath) {
    const ytdlp = getYtDlpPath();
    if (!ytdlp) throw new Error('yt-dlp not found.');

    console.log(`⚡ Fallback: Downloading video with yt-dlp...`);
    return new Promise((resolve, reject) => {
        const cmd = `"${ytdlp}" -o "${destPath}" --no-playlist --merge-output-format mp4 "${url}"`;
        exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('yt-dlp stderr:', stderr);
                reject(new Error(`yt-dlp failed: ${error.message}`));
            } else {
                console.log('✅ yt-dlp download complete');
                resolve();
            }
        });
    });
}

/**
 * Extract frames from a video URL at specific timestamps.
 * Supports TikTok URLs and direct mp4 URLs.
 */
async function extractFrames(videoUrl, manualTimestamps = null) {
    const tempDir = process.env.RENDER ? '/tmp' : path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const videoId = Date.now();
    const videoPath = path.join(tempDir, `video_${videoId}.mp4`);

    try {
        console.log(`🎥 Initiating Elite Extraction for: ${videoUrl}`);

        const isTikTok = videoUrl.includes('tiktok.com');

        if (isTikTok) {
            // PRIMARY: Use tikwm API (works on all servers including Render)
            try {
                const directUrl = await resolveTikTokUrl(videoUrl);
                console.log('⚡ Downloading TikTok video...');
                await downloadDirect(directUrl, videoPath);
            } catch (apiErr) {
                console.warn('⚠️ tikwm API failed, trying yt-dlp fallback...', apiErr.message);
                await downloadWithYtDlp(videoUrl, videoPath);
            }
        } else {
            console.log('⚡ Downloading video from direct URL...');
            await downloadDirect(videoUrl, videoPath);
        }

        if (!fs.existsSync(videoPath)) {
            throw new Error('Video download failed — file not created.');
        }

        const stats = fs.statSync(videoPath);
        console.log(`✅ DNA Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        // Get metadata (duration)
        const getMetadata = (filePath) => new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
            });
        });

        const metadata = await getMetadata(videoPath);
        const duration = metadata.format.duration || 30;

        // Dynamic sampling: stay inside 5-frame limit
        let timestamps = manualTimestamps;
        if (!timestamps) {
            timestamps = [
                0,
                Math.min(2, duration * 0.1),
                duration * 0.25,
                duration * 0.5,
                duration * 0.9
            ].map(t => Math.floor(t));
            timestamps = [...new Set(timestamps)].filter(t => t < duration).slice(0, 5);
        }

        const frames = [];
        console.log(`🧠 Deconstructing ${timestamps.length} Mastery Points across ${duration.toFixed(1)}s...`);

        for (const timestamp of timestamps) {
            const frameFilename = `frame_${videoId}_${timestamp}.jpg`;
            const framePath = path.join(tempDir, frameFilename);

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(videoPath)
                        .seekInput(timestamp)
                        .frames(1)
                        .output(framePath)
                        .on('end', resolve)
                        .on('error', reject)
                        .run();
                });

                if (fs.existsSync(framePath)) {
                    const frameBuffer = fs.readFileSync(framePath);
                    frames.push({
                        timestamp,
                        base64: frameBuffer.toString('base64'),
                        mimeType: 'image/jpeg'
                    });
                    fs.unlinkSync(framePath);
                }
            } catch (ffmpegErr) {
                console.warn(`⚠️ Skipping frame at ${timestamp}s:`, ffmpegErr.message);
            }
        }

        if (frames.length === 0) {
            throw new Error('Failed to extract any DNA samples.');
        }

        console.log(`🎨 Extracted ${frames.length} DNA samples successfully`);

        // Extract audio for transcription
        const audioPath = path.join(tempDir, `audio_${videoId}.mp3`);
        console.log('🎵 Extracting Audio DNA...');
        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(audioPath);
        });

        // Cleanup video
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

        return { frames, audioPath };

    } catch (error) {
        console.error('❌ Elite Extraction Pipeline Error:', error.message);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        throw error;
    }
}

module.exports = { extractFrames };
