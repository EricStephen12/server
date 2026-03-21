const adminOnly = (req, res, next) => {
    // authenticateClerk must be called before this to populate req.user
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.user.is_admin) {
        console.warn(`Admin access denied for user: ${req.user.email}`);
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    next();
};

module.exports = adminOnly;
