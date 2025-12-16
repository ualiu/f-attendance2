/**
 * Migration script to update employee shift values
 * Run with: node scripts/migrate-employee-shifts.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function migrateShifts() {
  console.log('\n🔄 Migrating employee shift values...\n');

  try {
    const Employee = mongoose.connection.collection('employees');

    // Find all employees with old shift format
    const employees = await Employee.find({}).toArray();

    console.log(`Found ${employees.length} employees\n`);

    let updateCount = 0;

    for (const employee of employees) {
      let newShift = employee.shift;

      // Map old shift values to new values
      if (employee.shift && employee.shift.includes('Day') || employee.shift.includes('7am') || employee.shift.includes('7:00')) {
        newShift = 'Day';
      } else if (employee.shift && (employee.shift.includes('Night') || employee.shift.includes('11:30') || employee.shift.includes('11pm'))) {
        newShift = 'Night';
      } else if (employee.shift && employee.shift.includes('Weekend')) {
        newShift = 'Weekend';
      }

      if (newShift !== employee.shift) {
        await Employee.updateOne(
          { _id: employee._id },
          { $set: { shift: newShift } }
        );
        console.log(`✅ Updated ${employee.name}: "${employee.shift}" → "${newShift}"`);
        updateCount++;
      } else {
        console.log(`⏭️  Skipped ${employee.name}: already "${employee.shift}"`);
      }
    }

    console.log(`\n✅ Migration complete! Updated ${updateCount} employees.`);

  } catch (error) {
    console.error('❌ Migration error:', error);
  }
}

async function main() {
  await connectDB();
  await migrateShifts();
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
