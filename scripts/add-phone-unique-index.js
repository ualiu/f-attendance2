require('dotenv').config();
const mongoose = require('mongoose');

async function addPhoneUniqueIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('employees');

    // Check for duplicate phone numbers before creating index
    const duplicates = await collection.aggregate([
      { $group: { _id: '$phone', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (duplicates.length > 0) {
      console.log('\n⚠️  WARNING: Found duplicate phone numbers:');
      duplicates.forEach(dup => {
        console.log(`   Phone: ${dup._id} (${dup.count} employees)`);
      });
      console.log('\n   Please fix duplicates before creating unique index.');
      console.log('   You can find them with: db.employees.find({ phone: "PHONE_NUMBER" })\n');
      process.exit(1);
    }

    // Create unique index on phone
    try {
      await collection.createIndex({ phone: 1 }, { unique: true });
      console.log('✅ Successfully created unique index on phone field');
    } catch (error) {
      if (error.code === 85 || error.code === 86) {
        console.log('ℹ️  Unique index on phone already exists');
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

addPhoneUniqueIndex();
