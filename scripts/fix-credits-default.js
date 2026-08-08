require('dotenv').config();
const postgres = require('postgres');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing');
  }
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
  await sql`ALTER TABLE users ALTER COLUMN credits_remaining SET DEFAULT 0`;
  console.log('OK: credits_remaining default is now 0');
  await sql.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
