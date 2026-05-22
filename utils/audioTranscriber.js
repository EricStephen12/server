const Groq = require('groq-sdk');
const fs = require('fs');


async function transcribeAudio(audioPath) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('Groq API Key is missing for Audio Transcription');
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 15000 });
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {

            const transcription = await groq.audio.transcriptions.create({
                file: fs.createReadStream(audioPath),
                model: "whisper-large-v3-turbo",
                response_format: "json",
                temperature: 0.0,
            });


            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            return transcription.text;

        } catch (error) {
            const isNetworkError = error.name === 'APIConnectionTimeoutError' || 
                                   ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(error.cause?.code) ||
                                   error.status >= 500;

            if (attempt < MAX_RETRIES && isNetworkError) {

                await new Promise(r => setTimeout(r, 2000));
            } else {

                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                throw new Error(`Audio transcription failed after ${MAX_RETRIES} attempts: ${error.message}`);
            }
        }
    }
}

module.exports = { transcribeAudio };
