require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { extractFrames } = require('./utils/frameExtractor');

async function benchmark() {
    const url = 'https://www.tiktok.com/@b_pastor/video/7623843348981353735?is_from_webapp=1&sender_device=pc';
    const start = Date.now();
    try {
        console.log('Extracting...');
        await extractFrames(url);
        console.log('Done in:', (Date.now() - start) / 1000, 'seconds');
    } catch (e) {
        console.error('Error:', e.message);
    }
}
benchmark();
