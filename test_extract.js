const { extractFrames } = require('./utils/frameExtractor');

async function test() {
    const url = 'https://www.tiktok.com/@tagareedabadi2024/video/7598960306315922710?is_from_webapp=1&sender_device=pc';
    try {
        console.log('Testing extraction for:', url);
        const result = await extractFrames(url);
        console.log('Success!');
        console.log('Frames extracted:', result.frames.length);
        console.log('Audio path:', result.audioPath);
    } catch (err) {
        console.error('Extraction failed:', err.message);
    }
}

test();
