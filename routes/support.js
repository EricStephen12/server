const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');



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


        res.json({ success: true, ticketId: ticket.id });
    } catch (err) {

        res.status(500).json({ error: 'Failed to submit ticket' });
    }
});

module.exports = router;
