const jwt = require('jsonwebtoken');
const { sql } = require('../db/index');



async function adminProtected(req, res, next) {

    let sessionToken = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    if (!sessionToken) {
        sessionToken = req.cookies['admin_token'] || req.cookies['__session'];
    }

    if (!sessionToken) {
        return res.status(401).json({ error: 'Unauthorized: No session token found' });
    }

    try {

        try {
            const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
            if (decoded && decoded.role === 'master_admin') {
                req.user = { id: '00000000-0000-0000-0000-000000000000', email: 'admin@eixora.store', is_admin: true, is_master_admin: true };
                return next();
            }
        } catch (jwtErr) {

        }


        const userId = req.body.userId || req.query.userId || req.headers['x-user-id'];
        
        if (userId) {

            const [user] = await sql`SELECT id, is_admin, email, name FROM users WHERE id = ${userId}`;

            if (user && user.is_admin) {
                req.user = user;
                return next();
            }
            

            return res.status(403).json({ error: 'Forbidden: Admin access only.' });
        }

        const ADMIN_EMAILS = ['deamirclothingstores@gmail.com', 'hello@eixora.store'];
        const emailFromReq = req.query.email || req.headers['x-user-email'];
        if (emailFromReq && ADMIN_EMAILS.includes(emailFromReq.toLowerCase())) {
            const [adminUser] = await sql`SELECT id, is_admin, email, name FROM users WHERE LOWER(email) = LOWER(${emailFromReq}) AND is_admin = TRUE`;
            if (adminUser) {
                req.user = { ...adminUser, is_admin: true };
                return next();
            }
        }

        return res.status(401).json({ error: 'Unauthorized: No valid session or user ID provided.' });

    } catch (err) {

        res.status(500).json({ error: 'Security Engine failure during authentication.' });
    }
}

module.exports = adminProtected;
