require('dotenv').config();
const mongoose = require('mongoose');

async function dropUsernameIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('supervisors');

    // Drop the username index
    try {
      await collection.dropIndex('username_1');
      console.log('✅ Successfully dropped username_1 index');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️ Index username_1 does not exist (already dropped)');
      } else {
        throw error;
      }
    }

    await mongoose.connection.close();
    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

dropUsernameIndex();
