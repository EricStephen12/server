const express = require('express');
const { Webhook } = require('svix');
const { sql } = require('../db/index');
const router = express.Router();

/**
 * Clerk Webhook Handler
 * Syncs Clerk user events (created, updated, deleted) to PostgreSQL
 */
router.post('/clerk', express.raw({ type: 'application/json' }), async (req, res) => {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
        console.error('CLERK_WEBHOOK_SECRET is missing');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Get the headers
    const svix_id = req.headers["svix-id"];
    const svix_timestamp = req.headers["svix-timestamp"];
    const svix_signature = req.headers["svix-signature"];

    if (!svix_id || !svix_timestamp || !svix_signature) {
        return res.status(400).json({ error: 'Missing svix headers' });
    }

    const payload = req.body;
    const wh = new Webhook(WEBHOOK_SECRET);

    let evt;
    try {
        evt = wh.verify(payload, {
            "svix-id": svix_id,
            "svix-timestamp": svix_timestamp,
            "svix-signature": svix_signature,
        });
    } catch (err) {
        console.error('Webhook verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
    }

    const { id } = evt.data;
    const eventType = evt.type;

    console.log(`Clerk Webhook Received [${eventType}]: ${id}`);

    try {
        if (eventType === 'user.created' || eventType === 'user.updated') {
            const { email_addresses, first_name, last_name, username, public_metadata } = evt.data;
            const email = email_addresses[0]?.email_address;
            const name = `${first_name || ''} ${last_name || ''}`.trim() || username || email.split('@')[0];
            const plan_type = public_metadata?.plan_type || 'free';
            const is_admin = public_metadata?.is_admin || false;

            await sql`
                INSERT INTO users (clerk_id, email, name, subscription_tier, is_admin, updated_at)
                VALUES (${id}, ${email}, ${name}, ${plan_type}, ${is_admin}, NOW())
                ON CONFLICT (email) DO UPDATE 
                SET clerk_id = ${id}, 
                    name = EXCLUDED.name,
                    subscription_tier = EXCLUDED.subscription_tier,
                    is_admin = EXCLUDED.is_admin,
                    updated_at = NOW()
            `;
        }

        if (eventType === 'user.deleted') {
            await sql`UPDATE users SET clerk_id = NULL WHERE clerk_id = ${id}`;
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Database sync error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;
