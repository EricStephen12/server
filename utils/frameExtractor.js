const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');

const { execSync } = require('child_process');

function findSystemFfmpeg() {
    try {
        const path = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
        if (path) return path;
    } catch (_) { }
    return null;
}

const systemFfmpeg = findSystemFfmpeg();

// Set paths
if (systemFfmpeg) {
    ffmpeg.setFfmpegPath(systemFfmpeg);
    console.log('✅ System ffmpeg found and set as primary:', systemFfmpeg);
} else if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic);
    console.log('✅ ffmpeg-static used as fallback:', ffmpegStatic);
}

// Set ffprobe path
if (ffprobeInstaller?.path) {
    ffmpeg.setFfprobePath(ffprobeInstaller.path);
}

/**
 * Downloads a file from a URL using axios (handles redirects, large files).
 * Includes TikTok CDN headers to prevent 403 on actual downloads.
 */
async function downloadDirect(url, destPath) {
    const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 90000,
        maxRedirects: 10,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
            'Origin': 'https://www.tiktok.com',
            'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    });

    if (response.status !== 200) {
        throw new Error(`Download failed: HTTP ${response.status}`);
    }

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });

    // Validate the file was actually saved
    const stat = fs.statSync(destPath);
    if (stat.size < 1000) {
        throw new Error(`Downloaded file is too small (${stat.size} bytes) — likely a failed CDN response.`);
    }
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
        // PREFER: Regular play URL (usually H.264, universally compatible)
        // SECONDARY: HD play URL (often uses BVC2/HEVC, might fail)
        const videoUrl = data.data.play || data.data.hdplay || data.data.wmplay;
        if (videoUrl) {
            console.log('✅ tikwm resolved video URL successfully (Preferred Standard MP4)');
            return videoUrl;
        }
    }

    throw new Error('tikwm API failed to resolve TikTok video URL.');
}

/**
 * Download a video using yt-dlp if available (local dev only).
 */
async function downloadWithYtDlp(url, destPath) {
    const { exec } = require('child_process');
    const { execSync } = require('child_process');
    let ytdlp = null;
    const localBin = path.join(__dirname, '../yt-dlp');
    if (fs.existsSync(localBin)) ytdlp = localBin;
    else { try { ytdlp = execSync('which yt-dlp', { encoding: 'utf-8' }).trim(); } catch (_) { } }
    if (!ytdlp) throw new Error('yt-dlp not available on this server.');
    console.log('⚡ Fallback: Downloading with yt-dlp...');
    return new Promise((resolve, reject) => {
        exec(`"${ytdlp}" -o "${destPath}" --no-playlist --merge-output-format mp4 "${url}"`,
            { timeout: 120000 }, (error, stdout, stderr) => {
                if (error) reject(new Error(`yt-dlp failed: ${error.message}`));
                else resolve();
            });
    });
}

/**
 * Extract frames from a video URL at specific timestamps.
 * Supports TikTok URLs and direct mp4 URLs.
 */
async function extractFrames(videoUrl, manualTimestamps = null) {
    // Robust temp directory handling
    const tempDir = os.tmpdir();
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const videoId = Date.now();
    const videoPath = path.join(tempDir, `socially_video_${videoId}.mp4`);

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
                    console.log(`🎬 Extracting frame at ${timestamp}s to ${framePath}...`);
                    ffmpeg(videoPath)
                        .seekInput(timestamp)
                        .frames(1)
                        .output(framePath)
                        .on('start', (cmd) => console.log('🚀 Running ffmpeg:', cmd))
                        .on('end', () => {
                            console.log(`✅ Frame extracted at ${timestamp}s`);
                            resolve();
                        })
                        .on('error', (err, stdout, stderr) => {
                            console.error(`❌ ffmpeg error at ${timestamp}s:`, err.message);
                            console.error('STDOUT:', stdout);
                            console.error('STDERR:', stderr);
                            // Fallback to accurate seek
                            ffmpeg(videoPath)
                                .seek(timestamp)
                                .frames(1)
                                .output(framePath)
                                .on('end', resolve)
                                .on('error', (err2, stdout2, stderr2) => {
                                    console.error('❌ Accurate seek fallback also failed');
                                    reject(err2);
                                })
                                .run();
                        })
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
