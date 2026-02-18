const axios = require('axios');

async function testPollinations() {
    const prompt = encodeURIComponent('Professional high-end product photography of a luxury watch, minimalist editorial display, premium lighting, 8k, photorealistic, sharp focus, clean background');
    const urls = [
        `https://pollinations.ai/p/${prompt}?seed=123&width=1024&height=1024`,
        `https://image.pollinations.ai/prompt/${prompt}?seed=123&width=1024&height=1024&nologo=true`
    ];

    for (const url of urls) {
        console.log(`Testing URL: ${url}`);
        const start = Date.now();
        try {
            const response = await axios.get(url, { responseType: 'stream', timeout: 30000 });
            console.log(`Status: ${response.status}`);
            console.log(`Time: ${Date.now() - start}ms`);
        } catch (err) {
            console.error(`Error: ${err.message}`);
        }
        console.log('---');
    }
}

testPollinations();
