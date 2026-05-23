const { sql } = require('./db/index');

async function run() {
  try {
    const [session] = await sql`
      SELECT id, user_id, title, messages, updated_at 
      FROM lounge_sessions 
      ORDER BY updated_at DESC 
      LIMIT 1
    `;
    if (!session) {
      console.log('No sessions found.');
      return;
    }
    console.log('Last Session ID:', session.id);
    console.log('User ID:', session.user_id);
    console.log('Title:', session.title);
    console.log('Updated At:', session.updated_at);
    console.log('Messages in DB:');
    console.log(session.messages);
  } catch (err) {
    console.error('Error fetching last session:', err.message);
  }
}

run();
