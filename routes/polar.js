const express = require('express');
const { sql } = require('../db/index');
const router = express.Router();
const crypto = require('crypto');

/**
 * Polar.sh Webhook Handler
 * Syncs Polar payment/subscription events to PostgreSQL
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['polar-webhook-signature'];
    const secret = process.env.POLAR_WEBHOOK_SECRET;
    
    // Security check: Verify the signature if secret is provided
    if (secret && signature) {
        const hmac = crypto.createHmac('sha256', secret);
        const digest = hmac.update(req.body).digest('hex');
        
        if (signature !== digest) {
            console.error('❌ Polar Webhook: Invalid Signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
    }

    try {
        const event = JSON.parse(req.body.toString());
        console.log(`❄️ Polar Webhook Received: [${event.type}]`);

        // We only care about successful orders or subscriptions
        if (event.type === 'order.created' || event.type === 'subscription.created') {
            const data = event.data;
            const email = data.customer_email || data.user_email || data.email;
            
            // Check metadata first, then fallback to product name or price
            let plan = data.metadata?.plan_type;
            
            if (!plan && data.amount) {
                // Polar amount is in cents, so $59 is 5900
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
