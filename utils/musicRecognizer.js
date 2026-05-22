const fs = require('fs');

async function uploadToTempHost(audioPath) {
    try {
        const fileData = fs.readFileSync(audioPath);
        const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
        
        let body = `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n`;
        body += `Content-Type: audio/mpeg\r\n\r\n`;
        
        const endBoundary = `\r\n--${boundary}--\r\n`;
        

        const payload = Buffer.concat([
            Buffer.from(body, 'utf8'),
            fileData,
            Buffer.from(endBoundary, 'utf8')
        ]);

        const response = await fetch('https://tmpfiles.org/api/v1/upload', {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length.toString()
            },
            body: payload
        });

        const data = await response.json();
        if (data && data.data && data.data.url) {

            // e.g., https://tmpfiles.org/12345/audio.mp3 -> https://tmpfiles.org/dl/12345/audio.mp3
            return data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
        }
        return null;
    } catch (err) {

        return null;
    }
}

async function identifyMusic(audioPath) {
    if (!process.env.RAPIDAPI_SHAZAM_KEY) {

        return null;
    }

    try {

        const publicUrl = await uploadToTempHost(audioPath);
        
        if (!publicUrl) {

            return null;
        }

        const response = await fetch(`https://shazam-song-recognition-api.p.rapidapi.com/recognize/url?url=${encodeURIComponent(publicUrl)}`, {
            method: 'GET',
            headers: {
                'x-rapidapi-host': 'shazam-song-recognition-api.p.rapidapi.com',
                'x-rapidapi-key': process.env.RAPIDAPI_SHAZAM_KEY
            }
        });

        const data = await response.json();
        
        if (data && data.track) {
            const result = `${data.track.title} by ${data.track.subtitle}`;

            return result;
        }
        

        return null;
    } catch (err) {

        return null;
    }
}

module.exports = { identifyMusic };
