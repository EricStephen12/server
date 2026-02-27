const postgres = require('postgres');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL missing');
    process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function migrate() {
    try {
        console.log('🚀 Starting Neon Migration...');
        const schemaPath = path.join(__dirname, 'neon_schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Split by semicolon and filter out empty strings to execute separately if needed, 
        // but postgres.js allows multi-statement strings if they don't return multiple results.
        // However, it's safer to run it as a whole if the driver supports it.
        await sql.unsafe(schema);

        console.log('✅ Migration successful!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        process.exit();
    }
}

migrate();
