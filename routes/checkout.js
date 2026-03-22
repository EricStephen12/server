const express = require('express');
const { Polar } = require('@polar-sh/sdk');
const authenticateClerk = require('../middleware/clerkAuth');
const router = express.Router();

const polar = new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    server: 'production' // or 'sandbox'
});

/**
 * Create a Polar Checkout Session
 */
router.post('/create-session', authenticateClerk, async (req, res) => {
    try {
        const { productId } = req.body;
        const userId = req.user.id; // From clerkAuth middleware

        console.log(`💎 Polar: Creating session for ${userId} | Product: ${productId}`);

        if (!productId) {
            return res.status(400).json({ error: 'Product ID is required' });
        }

        const session = await polar.checkouts.create({
            products: [productId], // Official Polar SDK way
            successUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?checkout_id={CHECKOUT_ID}`,
            customerEmail: req.user.email,
            metadata: {
                clerkId: userId,
                userId: userId
            }
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Polar Session Error:', err);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

module.exports = router;
