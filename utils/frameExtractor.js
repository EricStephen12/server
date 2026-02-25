const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

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
 * Extract frames from a video URL at specific timestamps
 * @param {string} videoUrl - URL of the video to extract frames from
 * @param {number[]} timestamps - Array of timestamps in seconds
 * @returns {Promise<string[]>} - Array of base64-encoded frame images
 */
async function extractFrames(videoUrl, manualTimestamps = null) {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const videoId = Date.now();
    const videoPath = path.join(tempDir, `video_${videoId}.mp4`);

    try {
        console.log(`🎥 Initiating Elite Extraction for: ${videoUrl}`);

        const ytdlCommand = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificates --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -o "${videoPath}" "${videoUrl}"`;

        console.log('⚡ Scraping TikTok Video DNA...');
        await execPromise(ytdlCommand);

        if (!fs.existsSync(videoPath)) {
            throw new Error('yt-dlp failed to create a video file.');
        }

        const stats = fs.statSync(videoPath);
        console.log(`✅ DNA Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        // Get Metadata (Duration)
        const getMetadata = (path) => new Promise((resolve, reject) => {
            ffmpeg.ffprobe(path, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
            });
        });

        const metadata = await getMetadata(videoPath);
        const duration = metadata.format.duration || 30;

        // Dynamic Sampling: Stay inside Groq's 5-image limit
        // We prioritize the Hook (0, 2s) and then spread the rest
        let timestamps = manualTimestamps;
        if (!timestamps) {
            timestamps = [
                0,
                Math.min(2, duration * 0.1),
                duration * 0.25,
                duration * 0.5,
                duration * 0.9
            ].map(t => Math.floor(t));

            // Deduplicate and filter (just in case video is < 5s)
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

        // Extract Audio for Transcription
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
