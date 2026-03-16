const { testConnection } = require('./db/index');

async function diags() {
    console.log('🔍 Testing DB connection...');
    const success = await testConnection();
    if (success) {
        console.log('✅ Connection successful!');
    } else {
        console.log('❌ Connection failed.');
    }
}

diags();
