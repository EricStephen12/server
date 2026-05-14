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
        
        let plan = data.plan_type || data.metadata?.plan_type;
        
        // If no plan_type is provided, guess based on amount (Selar amount is usually in base currency, but let's do a basic check)
        // Adjust these numbers based on your actual Selar currency configuration
        if (!plan) {
            if (amount >= 59) {
                plan = 'studio';
            } else {
                plan = 'creator'; // Default fallback
            }
        }

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
