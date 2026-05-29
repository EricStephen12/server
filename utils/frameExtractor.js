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
        const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
        const path = execSync(cmd, { encoding: 'utf-8' }).split('\n')[0].trim();
        if (path) return path;
    } catch (_) { }
    return null;
}

const systemFfmpeg = findSystemFfmpeg();


if (systemFfmpeg) {
    ffmpeg.setFfmpegPath(systemFfmpeg);

} else if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic);

}


if (ffprobeInstaller?.path) {
    ffmpeg.setFfprobePath(ffprobeInstaller.path);
}


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
            'Accept': 'video/mp4,video*;q=0.8',
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


    const stat = fs.statSync(destPath);
    if (stat.size < 1000) {
        throw new Error(`Downloaded file is too small (${stat.size} bytes) — likely a failed CDN response.`);
    }
}



async function resolveTikTokUrl(url) {



    const cleanUrl = url.split('?')[0];

    const response = await axios({
        method: 'post',
        url: 'https://tikwm.com/api/',
        timeout: 30000,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        data: `url=${encodeURIComponent(cleanUrl)}&hd=1`
    });

    const data = response.data;

    if (data?.code === 0 && data?.data) {


        const videoUrl = data.data.play || data.data.hdplay || data.data.wmplay;
        if (videoUrl) {

            return videoUrl;
        }
    }

    throw new Error('tikwm API failed to resolve TikTok video URL.');
}


async function downloadWithYtDlp(url, destPath) {
    const { exec } = require('child_process');
    const { execSync } = require('child_process');
    let ytdlp = 'yt-dlp'; // Default to system command

    try {
        const version = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
    } catch (e) {
        try {
            execSync('python -m yt_dlp --version', { encoding: 'utf-8' });
            ytdlp = 'python -m yt_dlp';
        } catch (e2) {
            const localBin = path.join(__dirname, '../yt-dlp');
            const localBinExe = path.join(__dirname, '../yt-dlp.exe');
            if (fs.existsSync(localBin)) {
                ytdlp = `"${localBin}"`;
            } else if (fs.existsSync(localBinExe)) {
                ytdlp = `"${localBinExe}"`;
            }
        }
    }


    return new Promise((resolve, reject) => {

        const cmd = `${ytdlp} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-playlist --merge-output-format mp4 --no-check-certificate -o "${destPath}" "${url}"`;
        exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {

                reject(new Error(`yt-dlp failed: ${error.message}`));
            } else {
                resolve();
            }
        });
    });
}



async function extractFrames(videoUrl, manualTimestamps = null) {

    const tempDir = os.tmpdir();
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const videoId = Date.now();
    let videoPath = path.join(tempDir, `eixora_video_${videoId}.mp4`);
    let isLocalFile = false;

    try {
        if (fs.existsSync(videoUrl)) {
            videoPath = videoUrl;
            isLocalFile = true;
        } else {
            try {
                await downloadWithYtDlp(videoUrl, videoPath);
            } catch (ytdlpErr) {
                const isTikTok = videoUrl.includes('tiktok.com');
                if (isTikTok) {
                    try {
                        const directUrl = await resolveTikTokUrl(videoUrl);
                        await downloadDirect(directUrl, videoPath);
                    } catch (tikErr) {
                        throw new Error(`Universal download failed: ${ytdlpErr.message} && ${tikErr.message}`);
                    }
                } else {
                    try {
                        await downloadDirect(videoUrl, videoPath);
                    } catch (dirErr) {
                        throw new Error(`Universal download failed: ${ytdlpErr.message} && ${dirErr.message}`);
                    }
                }
            }
        }

        if (!fs.existsSync(videoPath)) {
            throw new Error('Video processing failed — file not found.');
        }

        const stats = fs.statSync(videoPath);



        const getMetadata = (filePath) => new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
            });
        });

        const metadata = await getMetadata(videoPath);
        const duration = metadata.format.duration || 30;


        let timestamps = manualTimestamps;
        if (!timestamps) {
            // DENSE HOOK SAMPLING: 7 frames in the first 3 seconds (the money window)
            const hookFrames = [0, 0.5, 1, 1.5, 2, 2.5, 3].filter(t => t < duration);
            // BODY FRAMES: every 2.5 seconds for the rest of the video
            const bodyFrames = [];
            for (let t = 4; t < duration; t += 2.5) bodyFrames.push(Math.round(t * 10) / 10);
            timestamps = [...new Set([...hookFrames, ...bodyFrames])];
            timestamps = timestamps.filter(t => t < duration).slice(0, 20);
        }

        // Label each timestamp with its phase for the AI
        const labeledTimestamps = timestamps.map(t => {
            let phase = 'MID-ROLL';
            if (t <= 1) phase = 'HOOK OPEN';
            else if (t <= 3) phase = 'HOOK';
            else if (t <= 8) phase = 'PROBLEM/SETUP';
            else if (t >= duration * 0.85) phase = 'CTA/CLOSE';
            else if (t >= duration * 0.5) phase = 'SOLUTION/PAYOFF';
            return { time: t, phase };
        });

        const frames = [];

        for (const { time: timestamp, phase } of labeledTimestamps) {
            const frameFilename = `frame_${videoId}_${timestamp}.jpg`;
            const framePath = path.join(tempDir, frameFilename);

            try {
                await new Promise((resolve, reject) => {

                    ffmpeg(videoPath)
                        .seekInput(timestamp)
                        .frames(1)
                        .output(framePath)
                        .on('start', () => {})
                        .on('end', () => {
                            resolve();
                        })
                        .on('error', (err, stdout, stderr) => {

                            ffmpeg(videoPath)
                                .seek(timestamp)
                                .frames(1)
                                .output(framePath)
                                .on('end', resolve)
                                .on('error', (err2, stdout2, stderr2) => {
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
                        phase,
                        base64: frameBuffer.toString('base64'),
                        mimeType: 'image/jpeg'
                    });
                    fs.unlinkSync(framePath);
                }
            } catch (ffmpegErr) {

            }
        }

        if (frames.length === 0) {
            throw new Error('Failed to extract any DNA samples.');
        }




        let audioPath = path.join(tempDir, `audio_${videoId}.mp3`);

        try {
            await new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .noVideo()
                    .toFormat('mp3')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(audioPath);
            });
        } catch (audioErr) {
            console.warn(`Audio extraction failed (video may be silent): ${audioErr.message}`);
            // If the file was partially created, delete it
            if (fs.existsSync(audioPath)) {
                try { fs.unlinkSync(audioPath); } catch (_) {}
            }
            audioPath = null;
        }


        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

        return { frames, audioPath };

    } catch (error) {

        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        throw error;
    }
}

module.exports = { extractFrames };
