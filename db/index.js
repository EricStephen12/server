const postgres = require('postgres');
const dotenv = require('dotenv');

dotenv.config();

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {

}


const sql = postgres(connectionString, {
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
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
