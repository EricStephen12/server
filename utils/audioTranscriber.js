const Groq = require('groq-sdk');
const fs = require('fs');

/**
 * Transcribe audio using Groq Whisper API
 * @param {string} audioPath - Path to the mp3 audio file
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudio(audioPath) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('Groq API Key is missing for Audio Transcription');
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`🎙️ Groq Whisper Transcription (attempt ${attempt}/${MAX_RETRIES})...`);
            const transcription = await groq.audio.transcriptions.create({
                file: fs.createReadStream(audioPath),
                model: "whisper-large-v3-turbo",
                response_format: "json",
                temperature: 0.0,
            });

            // Cleanup audio file after transcription
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            return transcription.text;

        } catch (error) {
            const isNetworkError = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(error.cause?.code);
            console.warn(`⚠️ Transcription attempt ${attempt} failed: ${error.message}`);

            if (attempt < MAX_RETRIES && isNetworkError) {
                console.log(`🔄 Retrying in 2s...`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                // Cleanup if all attempts failed
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                throw new Error(`Audio transcription failed after ${MAX_RETRIES} attempts: ${error.message}`);
            }
        }
    }
}

module.exports = { transcribeAudio };
