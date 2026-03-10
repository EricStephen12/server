const { sql } = require('./db/index');

async function checkUsersTable() {
    try {
        const columns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users'
        `;
        console.log('--- Users Table Columns ---');
        console.table(columns);

        const [sample] = await sql`SELECT * FROM users LIMIT 1`;
        console.log('--- Sample User Data ---');
        console.log(sample);

        const adsCount = await sql`SELECT count(*) FROM ads`;
        console.log('--- Ads Table Count ---');
        console.table(adsCount);

        const scriptsCount = await sql`SELECT count(*) FROM scripts`;
        console.log('--- Scripts Table Count ---');
        console.table(scriptsCount);

    } catch (err) {
        console.error('Error checking table:', err);
    } finally {
        process.exit();
    }
}

checkUsersTable();
