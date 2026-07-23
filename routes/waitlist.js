const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');
const axios = require('axios');

router.post('/', async (req, res) => {
    try {
        const { email, platform } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Save to database
        const [waitlistEntry] = await sql`
            INSERT INTO waitlist (email, platform)
            VALUES (${email.toLowerCase().trim()}, ${platform || 'unknown'})
            RETURNING id, email, platform, created_at
        `;

        // Send a welcome email via Resend if API key exists
        if (process.env.RESEND_API_KEY) {
            try {
                await axios.post('https://api.resend.com/emails', {
                    from: 'Eixora Waitlist <team@eixora.store>',
                    to: email,
                    subject: 'You are on the Eixora Waitlist!',
                    html: `
                        <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto;">
                            <h2>Welcome to the Waitlist! 🎉</h2>
                            <p>Hey there,</p>
                            <p>You're officially on the list for the Eixora mobile app. We're currently processing the app for the App Store and Google Play.</p>
                            <p>We'll notify you the exact moment you can download it.</p>
                            <br/>
                            <p>Stay creative,</p>
                            <p><strong>The Eixora Team</strong></p>
                        </div>
                    `
                }, {
                    headers: {
                        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (emailErr) {
                console.error('Failed to send waitlist email:', emailErr.response?.data || emailErr.message);
                // We don't fail the request if the email fails, the user is still in the DB
            }
        }

        res.status(200).json({ success: true, message: 'Added to waitlist', entry: waitlistEntry });
    } catch (error) {
        console.error('Waitlist error:', error);

        // Postgres unique violation code = 23505 (replaces Prisma P2002)
        if (error.code === '23505') {
            return res.status(400).json({ error: 'This email is already on the waitlist!' });
        }

        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
