const express = require('express');
const router = express.Router();
const { sql } = require('../db/index');
const axios = require('axios');

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

        if (process.env.RESEND_API_KEY) {
            try {
                // 1. Notify Eixora Support (hello@eixora.store)
                await axios.post('https://api.resend.com/emails', {
                    from: 'Eixora Concierge <hello@eixora.store>',
                    to: 'hello@eixora.store',
                    subject: `[Support Ticket] ${subject}`,
                    html: `
                        <div style="font-family: sans-serif; color: #1e293b; max-width: 600px;">
                            <h2 style="color: #6d28d9;">New Support Ticket Submitted</h2>
                            <p><strong>From:</strong> ${email || 'Anonymous'}</p>
                            <p><strong>User ID:</strong> <code>${userId || 'N/A'}</code></p>
                            <p><strong>Subject:</strong> ${subject}</p>
                            <p><strong>Message:</strong></p>
                            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; white-space: pre-wrap;">
                                ${message}
                            </div>
                        </div>
                    `,
                    reply_to: email || undefined
                }, {
                    headers: {
                        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });

                // 2. Send automated confirmation to user
                if (email) {
                    await axios.post('https://api.resend.com/emails', {
                        from: 'Eixora Concierge <hello@eixora.store>',
                        to: email,
                        subject: `Ticket Received: ${subject}`,
                        html: `
                            <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px;">
                                <h2 style="font-family: serif; font-style: italic; color: #6d28d9;">We've received your message.</h2>
                                <p>Hi there,</p>
                                <p>This email confirms that our support team has received your inquiry. We'll look into it and get back to you shortly.</p>
                                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                                <p><strong>Subject:</strong> ${subject}</p>
                                <p><strong>Your Inquiry:</strong></p>
                                <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; white-space: pre-wrap;">
                                    ${message}
                                </div>
                                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                                <p style="font-size: 11px; color: #64748b;">This is an automated confirmation. Please do not reply directly to this email.</p>
                            </div>
                        `
                    }, {
                        headers: {
                            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    });
                }
            } catch (emailErr) {
                console.error('Error sending support emails via Resend:', emailErr.response?.data || emailErr.message);
            }
        } else {
            console.warn('RESEND_API_KEY is not defined in .env. Email dispatch skipped.');
        }

        res.json({ success: true, ticketId: ticket.id });
    } catch (err) {

        res.status(500).json({ error: 'Failed to submit ticket' });
    }
});

module.exports = router;
