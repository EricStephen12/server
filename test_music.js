require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { identifyMusic } = require('./utils/musicRecognizer');
const { extractFrames } = require('./utils/frameExtractor');

async function testMusic() {
    const url = 'https://www.tiktok.com/@b_pastor/video/7623843348981353735?is_from_webapp=1&sender_device=pc';
    try {
        const { audioPath } = await extractFrames(url);
        console.time('identifyMusic');
        const music = await identifyMusic(audioPath);
        console.timeEnd('identifyMusic');
        console.log('Music:', music);
    } catch (e) {
        console.error('Error:', e.message);
    }
}
testMusic();
