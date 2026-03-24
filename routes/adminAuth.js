const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

/**
 * POST /api/admin/auth/login
 * ELITE MINIMALIST DEBUG VERSION 🛡️
 */
router.post('/login', (req, res) => {
    try {
        console.log('📝 Minimal Admin Login attempt started...');

        if (!req.body) {
            console.error('❌ NO REQ.BODY FOUND!');
            return res.status(500).json({ error: 'Internal Server Error: No body found in request.' });
        }

        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Elite Access Key required.' });
        }

        console.log('🔐 Validating Password...');
        if (password === process.env.ADMIN_PASSWORD) {
            console.log('🔑 Password match. Signing JWT...');

            const token = jwt.sign(
                { role: 'master_admin', isAdmin: true },
                process.env.JWT_SECRET || 'fallback_secret_66723',
                { expiresIn: '12h' }
            );

            console.log('🔓 Login Success!');
            return res.json({ success: true, token });
        }

        console.warn('🚨 Invalid Master Password attempt.');
        res.status(401).json({ error: 'Invalid Elite Access Key.' });
    } catch (err) {
        console.error('💥 MINIMAL LOGIN CRASH:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

module.exports = router;
