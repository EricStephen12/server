require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ads = [
    // BEAUTY
    {
        title: '5-Minute Glass Skin Routine',
        niche: 'beauty',
        video_url: 'https://assets.mixkit.co/videos/preview/mixkit-girl-applying-makeup-in-front-of-mirror-3522-large.mp4',
        thumbnail_url: 'https://images.unsplash.com/photo-1616683693504-3ea7e9ad6fec?w=600&h=900&fit=crop',
        views_count: '2.4M',
        likes_count: '450K',
        comments_count: '1.2K',
        platform: 'tiktok',
        is_verified: true,
        analysis: {
            hook: "I was skeptical about this... but WOW.",
            problem: "My skin always felt dry and texture was awful.",
            solution: "This 3-step routine changed my texture in 1 week.",
            cta: "Get the glow kit now."
        }
    },
    {
        title: 'The Viral Lip Stain Hack',
        niche: 'beauty',
        video_url: 'https://assets.mixkit.co/videos/preview/mixkit-woman-applying-lipstick-in-a-mirror-3523-large.mp4',
        thumbnail_url: 'https://images.unsplash.com/photo-1596462502278-27bfdd403348?w=600&h=900&fit=crop',
        views_count: '890K',
        likes_count: '120K',
        comments_count: '850',
        platform: 'tiktok',
        is_verified: true,
        analysis: {
            hook: "Stop applying lipstick like this!",
            problem: "It smudges and fades within an hour.",
            solution: "Use this peel-off stain instead. It lasts 24 hours.",
            cta: "Link in bio to try it."
        }
    },
    // TECH
    {
        title: 'Minimalist Desk Setup Tour',
        niche: 'tech',
        video_url: 'https://assets.mixkit.co/videos/preview/mixkit-programmers-working-in-a-dark-office-3526-large.mp4',
        thumbnail_url: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&h=900&fit=crop',
        views_count: '3.4M',
        likes_count: '500K',
        comments_count: '2.1K',
        platform: 'tiktok',
        is_verified: true,
        analysis: {
            hook: "Your desk setup is killing your productivity.",
            problem: "Clutter and bad lighting make you tired.",
            solution: "Here are 3 gadgets to fix your workflow instantly.",
            cta: "Full list in my bio."
        }
    },
    // HOME
    {
        title: 'Aesthetic Kitchen Restock',
        niche: 'home',
        video_url: 'https://assets.mixkit.co/videos/preview/mixkit-person-cutting-vegetables-in-a-kitchen-3530-large.mp4',
        thumbnail_url: 'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?w=600&h=900&fit=crop',
        views_count: '6.7M',
        likes_count: '1.2M',
        comments_count: '8K',
        platform: 'tiktok',
        is_verified: true,
        analysis: {
            hook: "POV: You finally organized your messy pantry.",
            problem: "Finding ingredients used to be a nightmare.",
            solution: "These clear containers save so much space.",
            cta: "Grab the set on sale today."
        }
    }
];

async function seed() {
    console.log('🌱 Seeding Ads with Analysis...');

    // Clear existing to avoid duplicates for this demo
    await supabase.from('ads').delete().neq('id', 0);

    const { error } = await supabase
        .from('ads')
        .insert(ads);

    if (error) {
        console.error('Error seeding ads:', error);
    } else {
        console.log('✅ Successfully seeded ads with analysis!');
    }
}

seed();
