const { sql } = require('../db/index');

async function resolveInternalId(id, clerkInfo = null) {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;

  if (id === '00000000-0000-0000-0000-000000000000') return id;

  try {
    let [user] = await sql`SELECT id, email, subscription_tier FROM users WHERE clerk_id = ${id}`;
    
    if (user) {
      const email = clerkInfo?.email || null;
      const name = clerkInfo?.name || null;
      
      // If this clerk row is missing email but we have it now, check for a duplicate email row
      if (email && !user.email) {
        // Check if there's another row with this email that has a better subscription tier
        const [emailRow] = await sql`SELECT id, subscription_tier FROM users WHERE LOWER(email) = LOWER(${email}) AND id != ${user.id}`;
        
        if (emailRow && emailRow.subscription_tier !== 'free') {
          // Merge: update the clerk row with the email row's tier, then delete the email row
          await sql`UPDATE users SET email = ${email}, name = COALESCE(${name}, name), subscription_tier = ${emailRow.subscription_tier} WHERE id = ${user.id}`;
          await sql`DELETE FROM users WHERE id = ${emailRow.id}`;
        } else {
          // Just backfill the email/name on the clerk row
          await sql`UPDATE users SET email = ${email}, name = COALESCE(${name}, name) WHERE id = ${user.id}`;
        }
      }
      
      return user.id;
    }

    const email = clerkInfo?.email || null;
    const name = clerkInfo?.name || null;

    // Check if a row with this email already exists (e.g. created by Polar webhook)
    if (email) {
      const [emailUser] = await sql`SELECT id FROM users WHERE LOWER(email) = LOWER(${email})`;
      if (emailUser) {
        // Link the existing email row to this clerk_id
        await sql`UPDATE users SET clerk_id = ${id}, name = COALESCE(${name}, name) WHERE id = ${emailUser.id}`;
        return emailUser.id;
      }
    }

    const [newUser] = await sql`
      INSERT INTO users (clerk_id, email, name, subscription_tier, created_at)
      VALUES (${id}, ${email}, ${name}, 'free', ${new Date()})
      RETURNING id
    `;
    return newUser.id;
  } catch (err) {

    return null;
  }
}

module.exports = { resolveInternalId };
