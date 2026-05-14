const express = require('express');
const { sql } = require('../db/index');
const router = express.Router();

/**
 * Polar.sh Webhook Handler
 * Syncs Polar payment/subscription events to PostgreSQL
 */
router.post('/', async (req, res) => {
    // Polar sends event data in the body
    const event = req.body;
    
    // Security: In production, verify the webhook signature using Polar's secret!
    console.log(`❄️ Polar Webhook Received: [${event.type}]`);

    try {
        // We only care about successful orders or subscriptions
        if (event.type === 'order.created' || event.type === 'subscription.created') {
            const data = event.data;
            const email = data.customer_email || data.user_email || data.email;
            
            // Check metadata first, then fallback to product name or price
            let plan = data.metadata?.plan_type;
            
            if (!plan && data.amount) {
                // Polar amount is in cents, so $79 is 7900
                if (data.amount >= 5900) {
                    plan = 'studio';
                } else {
                    plan = 'creator';
                }
            } else if (!plan && data.product?.name) {
                const name = data.product.name.toLowerCase();
                if (name.includes('studio')) plan = 'studio';
                else plan = 'creator';
            }

            // Default fallback
            if (!plan) plan = 'creator';

            if (email) {
                console.log(`🏆 Polar: Granting ${plan} to ${email}`);

                // Update user tier based on email
                await sql`
                    UPDATE users 
                    SET subscription_tier = ${plan}, 
                        updated_at = ${new Date()}
                    WHERE email = ${email}
                `;
                
                return res.status(200).json({ success: true, message: `Upgraded to ${plan}` });
            }
        }

        res.status(200).json({ status: 'ignored' });
    } catch (err) {
        console.error('Polar Webhook Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
