const https = require('https');

const BACKEND = 'deamirclothingstores--eixora-backend-express-server.modal.run';
const CLERK_ID = 'user_2bgT0p7mF02S8x24F2qE2HlZ7V1';
const EMAIL = 'deamirclothingstores@gmail.com';

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://${BACKEND}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function run() {
  try {
    console.log('Testing /me endpoint...');
    const r = await get(`/api/me?userId=${CLERK_ID}&email=${encodeURIComponent(EMAIL)}&name=De`);
    console.log('Status:', r.status);
    console.log('plan_type:', r.body?.plan_type);
    console.log('subscription_tier:', r.body?.subscription_tier);
    console.log('monthly_usage:', JSON.stringify(r.body?.monthly_usage));
    console.log('total_videos_analyzed:', r.body?.total_videos_analyzed);
    if (r.body?.error) console.log('ERROR:', r.body.error);
  } catch(e) {
    console.log('Network error:', e.message);
  }
  process.exit(0);
}
run();
