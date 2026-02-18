const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

async function testModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const models = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-002",
        "gemini-1.5-pro",
        "gemini-2.0-flash-exp",
        "gemini-pro-vision"
    ];

    for (const m of models) {
        try {
            console.log(`Testing model: ${m}...`);
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent("Hello, respond with 'OK' if you can hear me.");
            console.log(`✅ Model ${m} is working! Response: ${result.response.text().trim()}`);
        } catch (e) {
            console.error(`❌ Model ${m} failed: ${e.message}`);
        }
    }
}

testModels();
