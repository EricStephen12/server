const { sql } = require('./db/index');

async function checkAndSetAdmin() {
    const email = 'deamirclothingstores@gmail.com';
    console.log(`🔍 Checking status for ${email}...`);
    try {
        const users = await sql`SELECT email, name, is_admin FROM users WHERE email = ${email}`;

        if (users.length === 0) {
            console.log('❌ User not found in database.');
            const allUsers = await sql`SELECT email FROM users LIMIT 10`;
            console.log('📋 Recent users in DB:', allUsers);
        } else {
            const user = users[0];
            console.log(`👤 User found. Current is_admin: ${user.is_admin}`);

            if (!user.is_admin) {
                console.log('⚡ Updating is_admin to TRUE...');
                await sql`UPDATE users SET is_admin = TRUE WHERE email = ${email}`;
                console.log('✅ Update successful.');
            } else {
                console.log('✅ User already has admin privileges.');
            }
        }
    } catch (err) {
        console.error('❌ Database error:', err.message);
    } finally {
        process.exit();
    }
}

checkAndSetAdmin();
