const postgres = require('postgres');
const dotenv = require('dotenv');

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL is missing in server/.env');
}

// Neon serverless connection
const sql = postgres(connectionString, {
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
});

/**
 * Helper to test the connection
 */
async function testConnection() {
    try {
        const result = await sql`SELECT 1 as result`;
        console.log('✅ Neon Database Connection Successful!');
        return true;
    } catch (error) {
        console.error('❌ Neon Database Connection Failed:', error.message);
        return false;
    }
}

module.exports = {
    sql,
    testConnection
};
