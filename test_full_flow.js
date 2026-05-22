require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { extractFrames } = require('./utils/frameExtractor');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');

async function testFull() {
    const url = 'https://www.tiktok.com/@tagareedabadi2024/video/7598960306315922710?is_from_webapp=1&sender_device=pc';
    try {
        console.log('1. Extracting frames...');
        const { frames } = await extractFrames(url);
        console.log('Frames extracted:', frames.length);

        console.log('2. Analyzing frames with Groq...');
        const result = await analyzeVideoFrames(frames, 'Test');
        console.log('Success!', result.big_idea);
    } catch (err) {
        console.error('Test failed:', err);
    }
}
testFull();
