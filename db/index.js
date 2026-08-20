const postgres = require('postgres');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Look for .env in current dir, parent dir, or server dir
const envPaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '.env'),
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), '.env'),
];

for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
    }
}

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
    console.error('[DB] CRITICAL: DATABASE_URL environment variable is missing!');
}


const sql = postgres(connectionString, {
    ssl: 'require',
    max: process.env.NODE_ENV === 'production' ? 10 : 5,  // Neon paid: 10, free: 5
    idle_timeout: 20,          // Close idle connections faster to save Neon quota
    connect_timeout: 30,
    max_lifetime: 1800,        // Recycle connections every 30 min
    prepare: false,            // Required for Neon serverless/pgBouncer compatibility
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
