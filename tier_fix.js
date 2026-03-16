const { sql } = require('./db/index');

async function fixTiers() {
    try {
        console.log('🔄 Fixing tiers via index bootstrap...');
        const result = await sql`
            UPDATE users 
            SET subscription_tier = 'founding' 
            WHERE subscription_tier = 'pro'
        `;
        console.log(`✅ Fixed ${result.count} users.`);
    } catch (err) {
        console.error('❌ Quick fix failed:', err.message);
    }
}

fixTiers();
