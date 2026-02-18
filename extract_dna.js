const { createClient } = require('@supabase/supabase-js');
const { extractFrames } = require('./utils/frameExtractor');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');
require('dotenv').config({ path: './.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function extractDna() {
    console.log('🤖 Starting AI Ad DNA Extraction...');

    // 1. Fetch ads that don't have visual_dna yet
    const { data: ads, error } = await supabase
        .from('ads')
        .select('*')
        .is('visual_dna', null)
        .eq('is_verified', true) // Focus on verified ads first
        .limit(1); // Smallest batch for testing

    if (error) {
        console.error('Error fetching ads:', error);
        return;
    }

    if (ads.length === 0) {
        console.log('✅ All ads have been processed!');
        return;
    }

    console.log(`📊 Found ${ads.length} ads to process.`);

    for (const ad of ads) {
        console.log(`\n🎬 Processing: "${ad.title}" (ID: ${ad.id})`);

        try {
            if (!ad.video_url) {
                console.log('⚠️ Skipping (no video URL)');
                continue;
            }

            // 2. Extract frames
            console.log('📸 Extracting frames...');
            const frames = await extractFrames(ad.video_url);

            // 3. Analyze with Gemini Vision
            console.log('🧠 Analyzing with Gemini Vision...');
            const dna = await analyzeVideoFrames(frames, `${ad.title} - ${ad.niche}`);

            // 4. Save DNA to DB
            const { error: updateError } = await supabase
                .from('ads')
                .update({ visual_dna: dna })
                .eq('id', ad.id);

            if (updateError) throw updateError;

            console.log(`✅ Success! DNA saved for: ${ad.title}`);

        } catch (err) {
            console.error(`❌ Failed processing ad ${ad.id}:`, err.message);
        }
    }

    console.log('\n🚢 Batch complete. Run again to process more.');
}

extractDna();
