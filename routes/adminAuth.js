const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Strict Rate Limiting for Admin Login 💎🛡️
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 attempts per window
    message: { error: 'Too many login attempts. Elite security protocol engaged. Please wait 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * POST /api/admin/auth/login
 * Master Admin Login via Secret Key
 */
router.post('/login', loginLimiter, (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'Elite Access Key required.' });
    }

    // Check against ENV password
    if (password === process.env.ADMIN_PASSWORD) {
        // Generate a specialized Admin JWT 💎
        const token = jwt.sign(
            { role: 'master_admin', isAdmin: true },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        console.log('🔓 Master Admin Login success.');

        // Set as secure HttpOnly cookie for production
        res.cookie('admin_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 12 * 60 * 60 * 1000 // 12 hours
        });

        return res.json({ success: true, token });
    }

    console.warn('🚨 Unauthorized Admin Login attempt!');
    res.status(401).json({ error: 'Invalid Elite Access Key.' });
});

/**
 * POST /api/admin/auth/logout
 */
router.post('/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ success: true, message: 'Elite session terminated.' });
});

module.exports = router;
