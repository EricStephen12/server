const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ytdl = require('@distube/ytdl-core');
const https = require('https');
const http = require('http');

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
 * Downloads a video from a direct URL to a local file path.
 */
function downloadDirect(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);
        protocol.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                // Follow redirect
                return downloadDirect(response.headers.location, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download video: HTTP ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (err) => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
}

/**
 * Extract frames from a video URL at specific timestamps.
 * Supports TikTok (via @distube/ytdl-core) and direct mp4 URLs.
 */
async function extractFrames(videoUrl, manualTimestamps = null) {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const videoId = Date.now();
    const videoPath = path.join(tempDir, `video_${videoId}.mp4`);

    try {
        console.log(`🎥 Initiating Elite Extraction for: ${videoUrl}`);

        const isTikTok = videoUrl.includes('tiktok.com');

        if (isTikTok) {
            // Use @distube/ytdl-core for TikTok
            console.log('⚡ Downloading TikTok video via ytdl-core...');
            const info = await ytdl.getInfo(videoUrl);
            const format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' })
                || ytdl.chooseFormat(info.formats, { filter: 'videoandaudio' });

            if (!format) throw new Error('No suitable video format found for TikTok URL.');

            await new Promise((resolve, reject) => {
                const stream = ytdl.downloadFromInfo(info, { format });
                const file = fs.createWriteStream(videoPath);
                stream.pipe(file);
                stream.on('error', reject);
                file.on('finish', resolve);
                file.on('error', reject);
            });
        } else {
            // Direct URL download (mp4 links, etc.)
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
