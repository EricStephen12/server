const { extractFrames } = require('./utils/frameExtractor');

async function test() {
    const url = 'https://www.tiktok.com/@kitsue__/video/7598144562007215367?is_from_webapp=1&sender_device=pc&web_id=7609376755233687056';
    try {
        console.log('Testing Elite Extraction for:', url);
        const frames = await extractFrames(url);
        console.log('Extracted frames count:', frames.length);
        if (frames.length > 0) {
            console.log('Success! First frame sample size:', frames[0].base64.length);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
