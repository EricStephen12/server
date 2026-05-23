const path = require('path');
const dotenv = require('dotenv');
// load environment variables from the server folder
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });

const { sql } = require('./db/index');

async function run() {
  try {
    const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'lounge_sessions'
    `;
    console.log('Columns:');
    console.log(JSON.stringify(columns, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
