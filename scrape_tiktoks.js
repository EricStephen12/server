const { ApifyClient } = require('apify-client');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const client = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
});

async function scrapeVideos() {
    try {
        console.log('Starting Apify scrape for #dropshipping...');
        const input = {
            hashtags: ['dropshipping'],
            resultsPerPage: 10,
            shouldDownloadVideos: false,
            shouldDownloadCovers: false,
        };

        // Using the tiktok-scraper actor (one of the most popular)
        // Note: The actor ID might vary, but 'clockworks/tiktok-scraper' is common.
        // If that fails, I'll try another or just search for the right one.
        const run = await client.actor('clockworks/tiktok-scraper').call(input);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        console.log(`Found ${items.length} videos.`);
        const urls = items.map(item => item.webVideoUrl).filter(url => !!url);

        fs.writeFileSync('tiktok_urls.json', JSON.stringify(urls, null, 2));
        console.log('URLs saved to tiktok_urls.json');
    } catch (error) {
        console.error('Scrape failed:', error.message);
        process.exit(1);
    }
}

scrapeVideos();
