const axios = require('axios');
const fs = require('fs');
const path = require('path');

const URLS = JSON.parse(fs.readFileSync(path.join(__dirname, 'tiktok_urls.json'), 'utf-8'));
// We already have v1, v2, v3. We need v4, v5, v6, v7, v8.
const VIDEOS = [
    { id: 'v4', url: URLS[2] }, // jparkecom
    { id: 'v5', url: URLS[3] }, // thekamiylahmonroe
    { id: 'v6', url: URLS[4] }, // bellas_life01
    { id: 'v7', url: URLS[5] }, // junglabs
    { id: 'v8', url: URLS[6] }  // momiketeaching
];

async function downloadVideos() {
    const videoDir = path.join(__dirname, '../client/public/videos');
    if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
    }

    for (const v of VIDEOS) {
        try {
            console.log(`Fetching ${v.id} from tikwm...`);
            const tikwmRes = await axios.post('https://tikwm.com/api/',
                `url=${encodeURIComponent(v.url)}&hd=1`,
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
            );

            const d = tikwmRes.data;
            const videoDownloadUrl = d.data?.hdplay || d.data?.play || d.data?.wmplay;

            if (!videoDownloadUrl) {
                console.warn(`Could not find URL for ${v.id}`);
                continue;
            }

            console.log(`Downloading ${v.id} from ${videoDownloadUrl}...`);
            const dlRes = await axios({
                method: 'get',
                url: videoDownloadUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.tiktok.com/',
                }
            });

            const outputPath = path.join(videoDir, `${v.id}.mp4`);
            const writer = fs.createWriteStream(outputPath);
            dlRes.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            console.log(`Success: ${v.id} saved.`);
        } catch (error) {
            console.error(`Failed ${v.id}:`, error.message);
        }
    }
}

downloadVideos();
