const https = require('https');
const dotenv = require('dotenv');
dotenv.config();

const key = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log(JSON.stringify(JSON.parse(data), null, 2));
    });
}).on('error', (err) => {
    console.error("Error: " + err.message);
});
