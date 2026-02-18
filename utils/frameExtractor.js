const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const { Downloader } = require('@tobyg74/tiktok-api-dl');

// Try to find ffmpeg path
try {
    const ffmpegPath = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
    if (ffmpegPath) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        console.log('✅ ffmpeg found at:', ffmpegPath);
    }
} catch (error) {
    // Try common paths
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
 * Resolve TikTok page URL to actual video download URL
 * @param {string} url - TikTok page URL
 * @returns {Promise<string>} - Direct video download URL
 */
async function resolveTikTokUrl(url) {
    try {
        console.log('🔍 Resolving TikTok URL...');
        const result = await Downloader(url, { version: 'v1' });

        if (result && result.status === 'success' && result.result) {
            const res = result.result;
            // Try different video quality options or addresses
            let videoUrl = res.video1 || res.video2 || res.video_hd || res.video ||
                (res.downloadAddr && res.downloadAddr[0]) ||
                (res.playAddr && res.playAddr[0]);

            // If videoUrl is an object, try to find a string URL inside it
            if (videoUrl && typeof videoUrl === 'object') {
                videoUrl = videoUrl.url || (Array.isArray(videoUrl) ? videoUrl[0] : null);
            }

            if (videoUrl && typeof videoUrl === 'string') {
                console.log('✅ TikTok video URL resolved');
                return videoUrl;
            }
        }

        throw new Error('Could not extract video URL from TikTok');
    } catch (error) {
        console.error('TikTok URL resolution failed:', error.message);
        // Return original URL as fallback
        return url;
    }
}

/**
 * Extract frames from a video URL at specific timestamps
 * @param {string} videoUrl - URL of the video to extract frames from
 * @param {number[]} timestamps - Array of timestamps in seconds (e.g., [0, 3, 6, 9])
 * @returns {Promise<string[]>} - Array of base64-encoded frame images
 */
async function extractFrames(videoUrl, timestamps = [0, 3, 6, 9, 12, 15]) {
    const tempDir = path.join(__dirname, '../temp');
    const videoPath = path.join(tempDir, `video_${Date.now()}.mp4`);

    // Create temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
        // Resolve TikTok URL if it's a TikTok page URL
        let downloadUrl = videoUrl;
        if (videoUrl.includes('tiktok.com')) {
            downloadUrl = await resolveTikTokUrl(videoUrl);
        }

        // Download video
        console.log('Downloading video from:', downloadUrl);
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.tiktok.com/',
                'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
            },
            maxRedirects: 5,
            timeout: 30000
        });

        const writer = fs.createWriteStream(videoPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Video downloaded successfully');

        // Verify the file exists and has content
        const stats = fs.statSync(videoPath);
        if (stats.size === 0) {
            throw new Error('Downloaded video file is empty');
        }
        console.log(`Video file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        // Extract frames
        const frames = [];

        for (const timestamp of timestamps) {
            const framePath = path.join(tempDir, `frame_${timestamp}s.jpg`);

            await new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .screenshots({
                        timestamps: [timestamp],
                        filename: `frame_${timestamp}s.jpg`,
                        folder: tempDir,
                        size: '1280x720'
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });

            // Read frame and convert to base64
            const frameBuffer = fs.readFileSync(framePath);
            const base64Frame = frameBuffer.toString('base64');
            frames.push({
                timestamp,
                base64: base64Frame,
                mimeType: 'image/jpeg'
            });

            // Clean up frame file
            fs.unlinkSync(framePath);
        }

        // Clean up video file
        fs.unlinkSync(videoPath);

        console.log(`Extracted ${frames.length} frames successfully`);
        return frames;

    } catch (error) {
        // Clean up on error
        if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
        }
        throw new Error(`Frame extraction failed: ${error.message}`);
    }
}

module.exports = { extractFrames };
