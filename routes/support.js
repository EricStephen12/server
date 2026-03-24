const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');
const authenticateClerk = require('../middleware/clerkAuth');

/**
 * POST /api/support/submit
 * Public or User support submission
 */
router.post('/submit', async (req, res) => {
    try {
        const { email, subject, message, userId } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ error: 'Subject and message are required.' });
        }

        const [ticket] = await sql`
            INSERT INTO support_tickets (user_id, email, subject, message)
            VALUES (${userId || null}, ${email || null}, ${subject}, ${message})
            RETURNING *
        `;

        console.log(`📩 New Support Ticket from ${email || userId || 'Anonymous'}: ${subject}`);
        res.json({ success: true, ticketId: ticket.id });
    } catch (err) {
        console.error('Support Submission Error:', err);
        res.status(500).json({ error: 'Failed to submit ticket' });
    }
});

module.exports = router;
