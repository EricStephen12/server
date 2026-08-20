const { sql } = require('../db/index');
const { sendWelcomeEmail } = require('./emails');
const crypto = require('crypto');

function getDeterministicUuid(seed) {
  if (!seed) return null;
  const hash = crypto.createHash('md5').update(String(seed)).digest('hex');
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

async function resolveInternalId(id, clerkInfo = null) {
  const cleanId = (id && typeof id === 'string' && id !== 'undefined' && id !== 'null' && id !== '[object Object]') ? id.trim() : null;
  const email = clerkInfo?.email && typeof clerkInfo.email === 'string' ? clerkInfo.email.trim() : null;
  const name = clerkInfo?.name && typeof clerkInfo.name === 'string' ? clerkInfo.name.trim() : null;

  if (!cleanId && !email) {
    console.warn('[userResolver] No valid ID or email provided to resolve.');
    return null;
  }

  // If already an internal UUID, return as-is
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (cleanId && uuidRegex.test(cleanId)) return cleanId;

  if (cleanId === '00000000-0000-0000-0000-000000000000') return cleanId;

  try {
    // 1. Check by clerk_id first if cleanId provided
    if (cleanId) {
      let [user] = await sql`SELECT id, email, subscription_tier FROM users WHERE clerk_id = ${cleanId}`;
      
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
    }

    // 2. Check if row with this email exists (e.g. created by webhook or previous auth)
    if (email) {
      const [emailUser] = await sql`SELECT id, clerk_id FROM users WHERE LOWER(email) = LOWER(${email})`;
      if (emailUser) {
        if (cleanId && !emailUser.clerk_id) {
          await sql`UPDATE users SET clerk_id = ${cleanId}, name = COALESCE(${name}, name) WHERE id = ${emailUser.id}`;
        }
        return emailUser.id;
      }
    }

    // 3. Upsert user safely to prevent concurrent race condition failures
    if (cleanId) {
      const [upsertedUser] = await sql`
        INSERT INTO users (clerk_id, email, name, subscription_tier, credits_remaining, created_at)
        VALUES (${cleanId}, ${email}, ${name}, 'free', 0, NOW())
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
    } else if (email) {
      // Fallback insert by email if no cleanId
      const [emailOnlyUser] = await sql`
        INSERT INTO users (email, name, subscription_tier, credits_remaining, created_at)
        VALUES (${email}, ${name}, 'free', 0, NOW())
        ON CONFLICT (email) DO UPDATE
          SET name = COALESCE(users.name, EXCLUDED.name),
              updated_at = NOW()
        RETURNING id
      `;
      if (emailOnlyUser) return emailOnlyUser.id;
    }

    // Fallback query if conflict update didn't return
    if (cleanId) {
      const [fallbackUser] = await sql`SELECT id FROM users WHERE clerk_id = ${cleanId}`;
      if (fallbackUser) return fallbackUser.id;
    }
    if (email) {
      const [fallbackEmail] = await sql`SELECT id FROM users WHERE LOWER(email) = LOWER(${email})`;
      if (fallbackEmail) return fallbackEmail.id;
    }

    return getDeterministicUuid(cleanId || email);

  } catch (err) {
    console.error('[resolveInternalId] Database unavailable:', err.message);
    // Self-healing fallback: Generate a deterministic, valid UUID from cleanId or email
    // This ensures scans and intelligence features NEVER halt even during database outages or quota limits
    const deterministicUuid = getDeterministicUuid(cleanId || email);
    if (deterministicUuid) {
      console.warn(`[resolveInternalId] Using offline/quota-safe UUID: ${deterministicUuid} for ${cleanId || email}`);
      return deterministicUuid;
    }
    return null;
  }
}

module.exports = { resolveInternalId };
