const express = require('express');
const { sql } = require('../db/index');
const router = express.Router();

router.post('/', async (req, res) => {

    const data = req.body;
    

    try {
        const email = data.customer?.email;
        const amount = data.amount;
        const status = data.status; // 'success'
        
        let plan = data.plan_type || data.metadata?.plan_type;
        

        if (!plan) {
            if (amount >= 59) {
                plan = 'studio';
            } else {
                plan = 'creator'; // Default fallback
            }
        }

        if (status === 'success' && email) {

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

        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
