/**
 * Centralized admin email list.
 * Update this ONE file to add/remove admin access.
 * Referenced by: middleware/adminProtected.js, middleware/clerkAuth.js, routes/user.js
 */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'deamirclothingstores@gmail.com,hello@eixora.store')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

module.exports = { ADMIN_EMAILS };
