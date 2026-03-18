const { sql } = require('./db/index');

async function fetchAds() {
    try {
        const ads = await sql`SELECT title, video_url FROM ads LIMIT 10`;
        console.log('=== ADS FROM DATABASE ===');
        ads.forEach((ad, i) => {
            console.log(`${i + 1}. ${ad.title}: ${ad.video_url}`);
        });
    } catch (error) {
        console.error('Error fetching ads:', error.message);
    } finally {
        process.exit();
    }
}

fetchAds();
