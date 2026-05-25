// Fix: Merge the orphan clerk row with the correct email row
require('dotenv').config();
const { sql } = require('./db/index');

async function mergeRows() {
    try {
        // The user's current Clerk login (no email, tier=free)
        const orphanClerkId = 'user_2bgT0p7mF02S8x24F2qE2HlZ7V1';
        const orphanRowId = 'c90dfede-af88-44e3-91ca-8637c2562e72';
        
        // The row that has the correct email and agency tier
        const emailRowId = '7a64a6d0-b24d-4ffe-8697-4a493aa9f0f7';
        const correctEmail = 'deamirclothingstores@gmail.com';
        
        console.log('Before fix:');
        const before = await sql`SELECT id, email, clerk_id, subscription_tier FROM users WHERE id IN (${orphanRowId}, ${emailRowId})`;
        before.forEach(u => console.log(`  ${u.id} | email: ${u.email || 'NULL'} | clerk: ${u.clerk_id || 'NULL'} | tier: ${u.subscription_tier}`));

        // Remove the old duplicate email row (its clerk_id was from a different session)
        await sql`DELETE FROM users WHERE id = ${emailRowId}`;

        // Update the orphan row: give it the correct email and agency tier
        await sql`
            UPDATE users 
            SET email = ${correctEmail}, 
                subscription_tier = 'agency'
            WHERE id = ${orphanRowId}
        `;
        
        console.log('\nAfter fix:');
        const after = await sql`SELECT id, email, clerk_id, subscription_tier FROM users WHERE clerk_id = ${orphanClerkId}`;
        after.forEach(u => console.log(`  ${u.id} | email: ${u.email || 'NULL'} | clerk: ${u.clerk_id || 'NULL'} | tier: ${u.subscription_tier}`));
        
        console.log('\n✅ Done! Your account is now agency tier.');
    } catch (err) {
        console.error('Error:', err.message);
    }
    process.exit(0);
}

mergeRows();
