const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function checkVideoUrls() {
    const { data, error } = await supabase
        .from('ads')
        .select('id, title, video_url')
        .limit(5);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('=== SAMPLE VIDEO URLs ===\n');
    data.forEach((ad, i) => {
        console.log(`${i + 1}. ${ad.title}`);
        console.log(`   URL: ${ad.video_url}\n`);
    });
}

checkVideoUrls();
