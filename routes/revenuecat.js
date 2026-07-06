const express = require('express');
const { sql } = require('../db/index');
const router = express.Router();

router.post('/', express.json(), async (req, res) => {
    try {
        // RevenueCat sends a JSON payload
        const event = req.body.event;
        if (!event) {
            return res.status(400).json({ error: 'Invalid payload' });
        }

        // Authorization check if you have a RevenueCat webhook auth token configured
        const authHeader = req.headers.authorization;
        const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
        if (secret && authHeader !== `Bearer ${secret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const type = event.type;
        const appUserId = event.app_user_id; // Frontend should set this to the user's UUID or Clerk ID
        const productId = event.product_id ? event.product_id.toLowerCase() : '';
        const entitlementId = event.entitlement_ids ? event.entitlement_ids.join(',').toLowerCase() : '';

        // Determine plan based on product ID or entitlement IDs
        let plan = 'free';
        if (productId.includes('studio') || entitlementId.includes('studio')) {
            plan = 'studio';
        } else if (productId.includes('creator') || entitlementId.includes('creator')) {
            plan = 'creator';
        }

        console.log(`[RevenueCat Webhook] Event: ${type}, User: ${appUserId}, Plan: ${plan}`);

        if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL' || type === 'UNCANCELLATION') {
            if (appUserId) {
                // Update subscription tier and status
                await sql`
                    UPDATE users 
                    SET subscription_tier = ${plan}, 
                        subscription_status = 'active'
                    WHERE id::text = ${appUserId} OR clerk_id = ${appUserId}
                `;
                return res.status(200).json({ success: true, message: `Upgraded to ${plan}` });
            }
        } else if (type === 'CANCELLATION' || type === 'EXPIRATION' || type === 'BILLING_ISSUE') {
            if (appUserId) {
                // For CANCELLATION, they retain access until EXPIRATION, but you may want to flag it
                // For simplicity, we just mark inactive/free on expiration or billing issue
                if (type === 'EXPIRATION' || type === 'BILLING_ISSUE') {
                    await sql`
                        UPDATE users 
                        SET subscription_tier = 'free', 
                            subscription_status = 'inactive'
                    WHERE id::text = ${appUserId} OR clerk_id = ${appUserId}
                    `;
                } else if (type === 'CANCELLATION') {
                    await sql`
                        UPDATE users 
                        SET subscription_status = 'canceled'
                        WHERE id::text = ${appUserId} OR clerk_id = ${appUserId}
                    `;
                }
                return res.status(200).json({ success: true, message: `Processed ${type}` });
            }
        }

        return res.status(200).json({ success: true, message: 'Event ignored' });
    } catch (error) {
        console.error('RevenueCat Webhook Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
