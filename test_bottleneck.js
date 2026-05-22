require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { transcribeAudio } = require('./utils/audioTranscriber');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');
const { extractFrames } = require('./utils/frameExtractor');

async function benchmarkFull() {
    const url = 'https://www.tiktok.com/@b_pastor/video/7623843348981353735?is_from_webapp=1&sender_device=pc';
    try {
        console.time('extractFrames');
        const { frames, audioPath } = await extractFrames(url);
        console.timeEnd('extractFrames');

        let transcript = "";
        if (audioPath) {
            console.time('transcribeAudio');
            transcript = await transcribeAudio(audioPath);
            console.timeEnd('transcribeAudio');
        }

        console.time('analyzeVideoFrames');
        await analyzeVideoFrames(frames, 'URL Analysis', transcript, null);
        console.timeEnd('analyzeVideoFrames');

        console.log('Done!');
    } catch (e) {
        console.error('Error:', e.message);
    }
}
benchmarkFull();
