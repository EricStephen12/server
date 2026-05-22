const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();


router.post('/login', (req, res) => {
    try {


        if (!req.body) {

            return res.status(500).json({ error: 'Internal Server Error: No body found in request.' });
        }

        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Elite Access Key required.' });
        }


        if (password === process.env.ADMIN_PASSWORD) {


            const token = jwt.sign(
                { role: 'master_admin', isAdmin: true },
                process.env.JWT_SECRET || 'fallback_secret_66723',
                { expiresIn: '12h' }
            );


            return res.json({ success: true, token });
        }


        res.status(401).json({ error: 'Invalid Elite Access Key.' });
    } catch (err) {

        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

module.exports = router;
