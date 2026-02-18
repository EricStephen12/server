const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

console.log('Testing connection to:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

async function testConnection() {
    const start = Date.now();
    console.log('Fetching ads...');
    const { data, error } = await supabase.from('ads').select('count', { count: 'exact', head: true });

    console.log(`Time taken: ${Date.now() - start}ms`);

    if (error) {
        console.error('Connection Failed:', error);
    } else {
        console.log('Connection Successful! Count:', data); // data is null for count/head, check count property properly if needed but successful return is enough
    }
}

testConnection();
