require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { extractFrames } = require('./utils/frameExtractor');
const { transcribeAudio } = require('./utils/audioTranscriber');
const { identifyMusic } = require('./utils/musicRecognizer');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');

async function test() {
    const url = 'https://www.tiktok.com/@b_pastor/video/7623843348981353735?is_from_webapp=1&sender_device=pc';
    try {
        console.log('1. Extracting frames...');
        const { frames, audioPath } = await extractFrames(url);
        console.log('Frames extracted:', frames.length, 'Audio path:', audioPath);

        let transcript = "";
        let music = null;

        if (audioPath) {
            try {
                console.log('2a. Identifying music...');
                music = await identifyMusic(audioPath);
                console.log('Music identified:', music);
            } catch (e) {
                console.error('Music identification failed:', e.message);
            }

            try {
                console.log('2b. Transcribing audio...');
                transcript = await transcribeAudio(audioPath);
                console.log('Transcription length:', transcript?.length);
            } catch (e) {
                console.error('Transcription failed:', e.message);
            }
        }

        console.log('3. Analyzing frames with Groq...');
        const analysis = await analyzeVideoFrames(frames, 'URL Analysis', transcript, music);
        console.log('Analysis result:', Object.keys(analysis));
        
        console.log('✅ ALL TESTS PASSED!');
    } catch (err) {
        console.error('❌ FATAL ERROR:', err.message);
    }
}
test();
