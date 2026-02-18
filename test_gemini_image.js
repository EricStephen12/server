const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testImageGen() {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });
        const prompt = "Professional high-end product photography of a luxury perfume bottle, minimalist editorial display, premium lighting, 8k, photorealistic";

        console.log("Generating image with gemini-2.5-flash-image...");
        const result = await model.generateContent(prompt);
        const response = await result.response;

        if (response.candidates[0]?.content?.parts[0]?.inlineData) {
            const imagePart = response.candidates[0].content.parts[0].inlineData;
            console.log("Image generation successful!");
            fs.writeFileSync('test_output_flash.jpg', Buffer.from(imagePart.data, 'base64'));
            console.log("Saved to test_output_flash.jpg");
        } else {
            console.log("No image data. Full response:", JSON.stringify(response, null, 2));
        }
    } catch (err) {
        console.error("Error:", err.message);
    }
}

testImageGen();
