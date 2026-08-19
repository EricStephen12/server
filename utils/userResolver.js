const { sql } = require('../db/index');
const { sendWelcomeEmail } = require('./emails');

async function resolveInternalId(id, clerkInfo = null) {
  if (!id) return null;

  // If already an internal UUID, return as-is
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;

  if (id === '00000000-0000-0000-0000-000000000000') return id;

  const email = clerkInfo?.email || null;
  const name = clerkInfo?.name || null;

  try {
    // 1. Check by clerk_id first
    let [user] = await sql`SELECT id, email, subscription_tier FROM users WHERE clerk_id = ${id}`;
    
    if (user) {
      // If this clerk row is missing email but we have it now, backfill or link
      if (email && !user.email) {
        const [emailRow] = await sql`SELECT id, subscription_tier FROM users WHERE LOWER(email) = LOWER(${email}) AND id != ${user.id}`;
        
        if (emailRow) {
          const targetTier = emailRow.subscription_tier !== 'free' ? emailRow.subscription_tier : user.subscription_tier;
          await sql`DELETE FROM users WHERE id = ${emailRow.id}`;
          await sql`UPDATE users SET email = ${email}, name = COALESCE(${name}, name), subscription_tier = ${targetTier} WHERE id = ${user.id}`;
        } else {
          await sql`UPDATE users SET email = ${email}, name = COALESCE(${name}, name) WHERE id = ${user.id}`;
        }
      }
      return user.id;
    }

    // 2. Check if row with this email exists (e.g. created by webhook or previous auth)
    if (email) {
      const [emailUser] = await sql`SELECT id FROM users WHERE LOWER(email) = LOWER(${email})`;
      if (emailUser) {
        await sql`UPDATE users SET clerk_id = ${id}, name = COALESCE(${name}, name) WHERE id = ${emailUser.id}`;
        return emailUser.id;
      }
    }

    // 3. Upsert user safely to prevent concurrent race condition failures
    const [upsertedUser] = await sql`
      INSERT INTO users (clerk_id, email, name, subscription_tier, credits_remaining, created_at)
      VALUES (${id}, ${email}, ${name}, 'free', 0, NOW())
      ON CONFLICT (clerk_id) DO UPDATE 
        SET email = COALESCE(users.email, EXCLUDED.email),
            name = COALESCE(users.name, EXCLUDED.name),
            updated_at = NOW()
      RETURNING id
    `;

    if (upsertedUser) {
      if (email) {
        sendWelcomeEmail({ name, email }).catch(err =>
          console.error('[Welcome Email] Non-fatal:', err.message)
        );
      }
      return upsertedUser.id;
    }

    // Fallback query if conflict update didn't return
    const [fallbackUser] = await sql`SELECT id FROM users WHERE clerk_id = ${id}`;
    return fallbackUser?.id || null;

  } catch (err) {
    console.error('[resolveInternalId] Retrying after error:', err.message);
    try {
      // Last-ditch select in case of transaction or concurrency collision
      const [retryUser] = await sql`SELECT id FROM users WHERE clerk_id = ${id} ${email ? sql`OR LOWER(email) = LOWER(${email})` : sql``}`;
      if (retryUser) return retryUser.id;
    } catch (retryErr) {
      console.error('[resolveInternalId] Final fallback failed:', retryErr.message);
    }
    return null;
  }
}

module.exports = { resolveInternalId };
