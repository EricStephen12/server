const { sql } = require('../db/index');

async function resolveInternalId(id, clerkInfo = null) {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;

  if (id === '00000000-0000-0000-0000-000000000000') return id;

  try {
    let [user] = await sql`SELECT id FROM users WHERE clerk_id = ${id}`;
    if (user) return user.id;

    const email = clerkInfo?.email || null;
    const name = clerkInfo?.name || null;

    const [newUser] = await sql`
      INSERT INTO users (clerk_id, email, name, subscription_tier, created_at)
      VALUES (${id}, ${email}, ${name}, 'free', ${new Date()})
      ON CONFLICT (email) DO UPDATE SET clerk_id = ${id}
      RETURNING id
    `;
    return newUser.id;
  } catch (err) {

    return null;
  }
}

module.exports = { resolveInternalId };
