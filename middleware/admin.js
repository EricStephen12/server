const { sql } = require('../db/index');

const adminOnly = async (req, res, next) => {
    const userId = req.body.userId || req.query.userId;
    
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID required' });
    }

    try {
        const [user] = await sql`SELECT is_admin, email FROM users WHERE id = ${userId}`;
        
        if (!user || !user.is_admin) {

            return res.status(403).json({ error: 'Forbidden: Admin access required' });
        }

        req.user = user; // Populate req.user for downstream use
        next();
    } catch (err) {

        res.status(500).json({ error: 'Internal server error during admin check' });
    }
};

module.exports = adminOnly;
