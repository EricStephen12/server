const { ApifyClient } = require('apify-client');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const apifyToken = process.env.APIFY_API_TOKEN;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Supabase credentials missing in .env');
    process.exit(1);
}

if (!apifyToken) {
    console.error('Error: APIFY_API_TOKEN missing in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const client = new ApifyClient({
    token: apifyToken,
});

async function scrapeTikTokAds(niche = 'dropshipping') {
    console.log(`🕷️  Starting scrape for niche: ${niche}...`);

    // Prepare the Actor input
    // Using "TikTok Scraper" (clockworks/tiktok-scraper) or similar
    // For this demo, we'll use a hashtag search
    const input = {
        "hashtags": [niche, "viral", "amazonfinds"],
        "resultsPerPage": 10,
        "shouldDownloadCovers": true,
        // searchSection must be empty string for hashtag search in this actor version
        "searchSection": ""
    };

    // Run the Actor and wait for it to finish
    // actorId: "clockworks/tiktok-scraper" is a popular one, ensuring we use a reliable one
    const run = await client.actor("clockworks/tiktok-scraper").call(input);

    console.log(`✅  Scrape finished! Fetching results from dataset ${run.defaultDatasetId}...`);

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log(`📦  Found ${items.length} videos. Saving to Supabase...`);

    let savedCount = 0;
    for (const item of items) {
        // Map Apify result to our DB Schema
        const adData = {
            niche: niche,
            platform: 'tiktok',
            video_url: item.videoUrl || item.webVideoUrl,
            thumbnail_url: item.videoMeta?.coverUrl,
            title: item.text,
            views_count: item.playCount,
            likes_count: item.diggCount,
            comments_count: item.commentCount,
            external_id: item.id,
            analysis: {
                hook: "AI Analysis Pending...",
                problem: "AI Analysis Pending...",
                solution: "AI Analysis Pending..."
            }
        };

        // Insert into DB
        const { error } = await supabase.from('ads').upsert(adData, { onConflict: 'external_id' });

        if (!error) {
            savedCount++;
        } else {
            console.error('Error saving ad:', error.message);
        }
    }

    console.log(`🎉  Success! Saved ${savedCount} new viral ads to the Library.`);
}

// Run if called directly
scrapeTikTokAds();
