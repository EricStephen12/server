require('dotenv').config();
const { sql } = require('./db/index');
async function test() {
    try {
        const users = await sql`SELECT * FROM users WHERE clerk_id = 'user_3DUZjBQKrfe36pp7hdeC0i3I0tb'`;
        console.log('Users:', users);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
