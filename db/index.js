const postgres = require('postgres');
const dotenv = require('dotenv');

dotenv.config();

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {

}


const sql = postgres(connectionString, {
    ssl: 'require',
    max: 20,              // Increased pool size for high traffic
    idle_timeout: 30,     // Close idle connections after 30s
    connect_timeout: 30,
    max_lifetime: 1800,   // Recycle connections every 30 min
    prepare: false,       // Required for Neon serverless/pgBouncer compatibility
});


async function testConnection() {
    try {
        const result = await sql`SELECT 1 as result`;

        return true;
    } catch (error) {

        return false;
    }
}

module.exports = {
    sql,
    testConnection
};
