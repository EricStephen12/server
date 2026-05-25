require('dotenv').config();
const { sql } = require('./db/index');

async function check() {
    try {
        const res = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_benchmarks'`;
        console.log("Columns:", res.map(r => r.column_name));
        
        const count = await sql`SELECT count(*) FROM ad_benchmarks`;
        console.log("Total rows:", count[0].count);
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
check();
