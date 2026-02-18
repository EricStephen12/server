const fs = require('fs');

async function generateHeroImage() {
    const apiKey = 'sk_tSVLMXzhvMm3FL7dUhEWTcc8FdNzDi5n';
    const prompt = encodeURIComponent('Professional marketing hero image, confident young entrepreneur using laptop in modern bright office, warm natural lighting, vibrant colors, contemporary workspace with plants, clean aesthetic, photorealistic, 8k quality, welcoming atmosphere');
    const url = `https://gen.pollinations.ai/image/${prompt}?model=nanobanana&width=1920&height=1080&seed=${Date.now()}&nologo=true&key=${apiKey}`;

    console.log('🎨 Generating hero image...');
    console.log('URL:', url.substring(0, 100) + '...');

    try {
        const response = await fetch(url);
        console.log('Status:', response.status);
        console.log('Content-Type:', response.headers.get('content-type'));

        if (!response.ok) {
            const text = await response.text();
            console.error('Error response:', text);
            throw new Error(`HTTP ${response.status}: ${text}`);
        }

        const buffer = await response.arrayBuffer();
        const outputPath = '/home/eric/Documents/socially/client/public/hero-person.jpg';
        fs.writeFileSync(outputPath, Buffer.from(buffer));
        console.log('✅ Hero image saved to:', outputPath);
        console.log('File size:', buffer.byteLength, 'bytes');
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

generateHeroImage();
