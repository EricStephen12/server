const express = require('express');
const { sql } = require('../db/index');
const router = express.Router();
const crypto = require('crypto');

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['polar-webhook-signature'];
    const secret = process.env.POLAR_WEBHOOK_SECRET;
    

    if (secret && signature) {
        const hmac = crypto.createHmac('sha256', secret);
        const digest = hmac.update(req.body).digest('hex');
        
        if (signature !== digest) {

            return res.status(401).json({ error: 'Invalid signature' });
        }
    }

    try {
        const event = JSON.parse(req.body.toString());

        if (event.type === 'order.created' || event.type === 'subscription.created') {
            const data = event.data;
            const email = data.customer_email || data.user_email || data.email;
            

            let plan = data.metadata?.plan_type;
            
            if (!plan && data.amount) {

                if (data.amount >= 1000) {
                    plan = 'studio';
                } else {
                    plan = 'creator';
                }
            } else if (!plan && data.product?.name) {
                const name = data.product.name.toLowerCase();
                if (name.includes('studio')) plan = 'studio';
                else plan = 'creator';
            }

            if (!plan) plan = 'creator';

            if (email) {

                await sql`
                    UPDATE users 
                    SET subscription_tier = ${plan}, 
                        updated_at = ${new Date()}
                    WHERE LOWER(email) = LOWER(${email})
                `;
                
                return res.status(200).json({ success: true, message: `Upgraded to ${plan}` });
            }
        } else if (event.type === 'subscription.updated' || event.type === 'subscription.canceled' || event.type === 'subscription.revoked') {
            const data = event.data;
            const email = data.customer_email || data.user_email || data.email;
            

            if (event.type === 'subscription.canceled' || event.type === 'subscription.revoked' || data.status === 'canceled' || data.status === 'incomplete') {
                if (email) {

                    
                    await sql`
                        UPDATE users 
                        SET subscription_tier = 'free', 
                            updated_at = ${new Date()}
                        WHERE LOWER(email) = LOWER(${email})
                    `;
                    
                    return res.status(200).json({ success: true, message: `Downgraded ${email} to free` });
                }
            } else if (event.type === 'subscription.updated') {

                 let plan = data.metadata?.plan_type;
                 if (!plan && data.amount) plan = data.amount >= 1000 ? 'studio' : 'creator';
                 if (!plan && data.product?.name) plan = data.product.name.toLowerCase().includes('studio') ? 'studio' : 'creator';
                 if (!plan) plan = 'creator';

                 if (email && data.status === 'active') {

                    await sql`
                        UPDATE users 
                        SET subscription_tier = ${plan}, 
                            updated_at = ${new Date()}
                        WHERE LOWER(email) = LOWER(${email})
                    `;
                    return res.status(200).json({ success: true, message: `Updated ${email} to ${plan}` });
                 }
            }
        }

        res.status(200).json({ status: 'ignored' });
    } catch (err) {

        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
