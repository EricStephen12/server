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

    try {
        console.log('🎙️ Initiating Groq Whisper Transcription...');
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
        console.error('Groq Transcription error:', error);
        // Cleanup if error
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        throw new Error(`Audio transcription failed: ${error.message}`);
    }
}

module.exports = { transcribeAudio };
