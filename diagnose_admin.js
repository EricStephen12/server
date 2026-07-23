require('dotenv').config();
const { sql } = require('./db/index');

async function diagnose() {
  console.log('\n=== ADMIN DIAGNOSIS ===\n');

  // 1. Check if the email exists at all
  const byEmail = await sql`SELECT id, email, clerk_id, is_admin, subscription_tier FROM users WHERE LOWER(email) = 'deamirclothingstores@gmail.com'`;
  console.log('User by email:', byEmail);

  // 2. Check all users with a clerk_id set
  const withClerk = await sql`SELECT id, email, clerk_id, is_admin FROM users WHERE clerk_id IS NOT NULL LIMIT 10`;
  console.log('\nUsers with clerk_id:', withClerk);

  // 3. Total users
  const [count] = await sql`SELECT count(*) FROM users`;
  console.log('\nTotal users in DB:', count.count);

  process.exit(0);
}

diagnose().catch(e => { console.error(e); process.exit(1); });
