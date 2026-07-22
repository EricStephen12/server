const express = require('express');
const { Webhook } = require('svix');
const { sql } = require('../db/index');
const router = express.Router();

// Note: express.raw must be used for Svix signature verification to work properly.
// We assume it's mounted with express.raw before express.json parsing, OR we do it here.
// Since index.js has app.use(express.json()) globally, we might need a workaround if it parses it first.
// The easiest way is to use express.raw({ type: 'application/json' }) on this specific route,
// but it requires this router to be mounted BEFORE app.use(express.json()) in index.js.
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body;
  const headers = req.headers;

  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Polar Webhook] Missing POLAR_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const wh = new Webhook(webhookSecret);
  let evt;

  try {
    evt = wh.verify(payload, headers);
  } catch (err) {
    console.error('[Polar Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    const eventType = evt.type;
    const data = evt.data;

    console.log(`[Polar Webhook] Event received: ${eventType}`);

    // Determine the user's email
    const email = data.customer_email || (data.customer && data.customer.email) || data.user_email;

    if (eventType === 'subscription.created' || eventType === 'subscription.updated' || eventType === 'subscription.active') {
      const productId = data.product_id;
      
      let plan = 'free';
      // Fallback matching logic in case exact IDs aren't in env or are named differently
      if (productId === process.env.NEXT_PUBLIC_POLAR_STUDIO_ID || (data.product && data.product.name && data.product.name.toLowerCase().includes('studio'))) {
          plan = 'studio';
      } else if (productId === process.env.NEXT_PUBLIC_POLAR_CREATOR_ID || (data.product && data.product.name && data.product.name.toLowerCase().includes('creator'))) {
          plan = 'creator';
      } else if (productId && productId.includes('studio')) {
          plan = 'studio';
      } else if (productId && productId.includes('creator')) {
          plan = 'creator';
      }

      if (email && plan !== 'free') {
          await sql`
              UPDATE users 
              SET subscription_tier = ${plan}, 
                  subscription_status = 'active'
              WHERE email = ${email.toLowerCase()}
          `;
          console.log(`[Polar Webhook] Upgraded ${email} to ${plan}`);
      } else if (!email) {
          console.warn(`[Polar Webhook] No email found in payload for event ${eventType}`);
      }
    } else if (eventType === 'subscription.canceled' || eventType === 'subscription.revoked') {
      if (email) {
          await sql`
              UPDATE users 
              SET subscription_tier = 'free', 
                  subscription_status = 'inactive'
              WHERE email = ${email.toLowerCase()}
          `;
          console.log(`[Polar Webhook] Downgraded ${email} to free`);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Polar Webhook] Processing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
