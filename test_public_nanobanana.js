const axios = require('axios');
const fs = require('fs');

async function testPublicNanoBanana() {
    const prompt = encodeURIComponent("A futuristic city in the style of nano banana, neon lights, high tech");
    const url = `https://image.pollinations.ai/prompt/${prompt}?model=nanobanana&width=1024&height=1024&seed=42&nologo=true`;

    console.log(`Testing URL: ${url}`);

    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        console.log(`Status: ${response.status}`);
        console.log(`Content-Type: ${response.headers['content-type']}`);

        if (response.status === 200) {
            fs.writeFileSync('test_public_nanobanana.jpg', response.data);
            console.log("✅ Success! Image saved to test_public_nanobanana.jpg");
        } else {
            console.log("❌ Failed to generate image.");
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

testPublicNanoBanana();
