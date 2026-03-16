const { sql } = require('../db/index');

async function renameTiers() {
    try {
        console.log('🚀 Renaming internal tiers...');

        // Update existing users
        const result = await sql`
      UPDATE users 
      SET subscription_tier = 'founding' 
      WHERE subscription_tier = 'pro'
    `;
        console.log(`✅ Updated ${result.count} users from 'pro' to 'founding'`);

        console.log('🎊 Tier renaming complete!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Renaming failed:', err);
        process.exit(1);
    }
}

renameTiers();
