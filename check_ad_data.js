const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAdAnalysis() {
  const { data, error } = await supabase
    .from('ads')
    .select('id, title, analysis')
    .limit(3);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('=== AD ANALYSIS DATA ===\n');
  data.forEach((ad, i) => {
    console.log(`\n--- AD #${i + 1}: ${ad.title} ---`);
    console.log('Analysis:', JSON.stringify(ad.analysis, null, 2));
  });
}

checkAdAnalysis();
