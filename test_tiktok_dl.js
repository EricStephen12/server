const { Downloader } = require('@tobyg74/tiktok-api-dl');

async function test() {
    const url = 'https://www.tiktok.com/@kitsue__/video/7598144562007215367?is_from_webapp=1&sender_device=pc&web_id=7609376755233687056';
    try {
        console.log('Testing resolution for:', url);
        const result = await Downloader(url, { version: 'v1' });
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
