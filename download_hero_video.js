const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function downloadVideo() {
    const videoUrl = 'https://www.tiktok.com/@alexfindsbest/video/7578168112730606870';
    const outputPath = path.join(__dirname, '../client/public/hero-video.mp4');

    try {
        console.log('Fetching download URL from tikwm...');
        const tikwmRes = await axios.post('https://tikwm.com/api/',
            `url=${encodeURIComponent(videoUrl)}&hd=1`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
        );

        const d = tikwmRes.data;
        if (d.code !== 0) {
            throw new Error(`TikWM error: ${d.msg}`);
        }

        const videoDownloadUrl = d.data?.hdplay || d.data?.play || d.data?.wmplay;
        if (!videoDownloadUrl) {
            throw new Error('Could not find video play URL in TikWM response');
        }

        console.log('Downloading video from:', videoDownloadUrl);
        const dlRes = await axios({
            method: 'get',
            url: videoDownloadUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.tiktok.com/',
            }
        });

        const writer = fs.createWriteStream(outputPath);
        dlRes.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Video downloaded successfully to:', outputPath);
    } catch (error) {
        console.error('Download failed:', error.message);
        process.exit(1);
    }
}

downloadVideo();
