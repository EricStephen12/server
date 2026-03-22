const express = require('express');
const { Webhook } = require('svix');
const { sql } = require('../db/index');
const router = express.Router();

/**
 * Polar.sh Webhook Handler
 * Syncs Polar subscription events to PostgreSQL
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    const WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
        console.error('POLAR_WEBHOOK_SECRET is missing');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Get the headers
    const webhook_id = req.headers["webhook-id"];
    const webhook_timestamp = req.headers["webhook-timestamp"];
    const webhook_signature = req.headers["webhook-signature"];

    if (!webhook_id || !webhook_timestamp || !webhook_signature) {
        return res.status(400).json({ error: 'Missing webhook headers' });
    }

    const payload = req.body;
    const wh = new Webhook(WEBHOOK_SECRET);

    let evt;
    try {
        evt = wh.verify(payload, {
            "svix-id": webhook_id,
            "svix-timestamp": webhook_timestamp,
            "svix-signature": webhook_signature,
        });
    } catch (err) {
        console.error('Polar Webhook verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
    }

    const eventType = evt.type;
    console.log(`❄️ Polar Webhook Received [${eventType}]`);

    try {
        // 1. Handle Successful Purchase/Subscription
        if (eventType === 'order.created' || eventType === 'subscription.created') {
            const data = evt.data;
            const email = data.customer_email || data.user?.email;
            const userId = data.metadata?.userId || data.metadata?.clerkId;
            const productName = data.product?.name?.toLowerCase() || '';

            // Map product names to tiers
            let tier = 'free';
            if (productName.includes('founding')) tier = 'founding';
            if (productName.includes('agency')) tier = 'agency';

            if (!email && !userId) {
                console.warn('Polar Webhook: No user identification in payload');
                return res.status(200).json({ status: 'ignored' });
            }

            console.log(`🏆 Polar: Granting ${tier} to ${email || userId}`);

            if (userId) {
                await sql`UPDATE users SET subscription_tier = ${tier} WHERE clerk_id = ${userId}`;
            } else if (email) {
                await sql`UPDATE users SET subscription_tier = ${tier} WHERE email = ${email}`;
            }
        }

        // 2. Handle Cancellation/Revocation
        if (eventType === 'subscription.revoked' || eventType === 'subscription.deleted') {
            const data = evt.data;
            const userId = data.metadata?.userId || data.metadata?.clerkId;
            const email = data.user?.email;

            console.log(`❌ Polar: Revoking access for ${email || userId}`);

            if (userId) {
                await sql`UPDATE users SET subscription_tier = 'free' WHERE clerk_id = ${userId}`;
            } else if (email) {
                await sql`UPDATE users SET subscription_tier = 'free' WHERE email = ${email}`;
            }
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Polar Sync error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;
