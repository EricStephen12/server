const express = require('express');
const { sql } = require('../db/index');
const router = express.Router();

/**
 * Selar Webhook Handler
 * Syncs Selar payment events to PostgreSQL
 */
router.post('/', async (req, res) => {
    // Selar sends transaction data in the body
    const data = req.body;
    
    // Security: You should verify the request came from Selar
    // Selar usually sends a payload you can verify, or you can check a specific header
    // For now, we'll log the event and process the payment
    console.log('💰 Selar Webhook Received:', data.reference);

    try {
        const email = data.customer?.email;
        const amount = data.amount;
        const status = data.status; // 'success'
        
        // We can pass custom data through Selar's 'custom_fields' or 'metadata'
        // Let's assume we pass the userId or plan type
        const plan = data.plan_type || 'founding'; // Fallback to founding

        if (status === 'success' && email) {
            console.log(`🏆 Selar: Granting ${plan} to ${email}`);

            // Update user tier based on email
            await sql`
                UPDATE users 
                SET subscription_tier = ${plan}, 
                    updated_at = ${new Date()}
                WHERE email = ${email}
            `;
            
            return res.status(200).json({ success: true });
        }

        res.status(200).json({ status: 'ignored' });
    } catch (err) {
        console.error('Selar Webhook Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
