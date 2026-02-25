const Groq = require('groq-sdk');
require('dotenv').config();

async function listModels() {
    if (!process.env.GROQ_API_KEY) {
        console.error('GROQ_API_KEY is missing');
        return;
    }
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    try {
        const models = await groq.models.list();
        console.log('Available Models:');
        models.data.forEach(model => {
            console.log(`- ${model.id}`);
        });
    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
