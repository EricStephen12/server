const { getCachedAnalysis, setCachedAnalysis, getCacheStats } = require('./utils/analysisCache');

async function test() {
  console.log('Testing Redis connection...');
  
  const stats = await getCacheStats();
  console.log('Cache backend:', stats);

  // Test set
  await setCachedAnalysis('https://www.tiktok.com/@test/video/123', { test: true, niche: 'test' });
  console.log('✅ SET worked');

  // Test get
  const result = await getCachedAnalysis('https://www.tiktok.com/@test/video/123');
  console.log('✅ GET result:', result);

  if (result?.test === true) {
    console.log('🎉 Redis cache is working perfectly!');
  } else {
    console.log('⚠️  Using memory cache fallback (Redis not connected)');
  }

  process.exit(0);
}

test().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
