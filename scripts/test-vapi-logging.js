/**
 * Test script to verify VAPI call logging works
 * Run with: node scripts/test-vapi-logging.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const vapiService = require('../services/vapiService');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function testVapiLogging() {
  console.log('\n🧪 Testing VAPI Call Logging...\n');

  try {
    // Find a test employee
    const employee = await Employee.findOne({});

    if (!employee) {
      console.error('❌ No employees found in database. Please add an employee first.');
      return;
    }

    console.log(`✅ Found test employee: ${employee.name} (ID: ${employee.employee_id})`);
    console.log(`   Work Station: ${employee.work_station}`);
    console.log(`   Current Points: ${employee.points_current_quarter}`);

    // Test get_employee_record
    console.log('\n📋 Test 1: get_employee_record');
    const employeeRecord = await vapiService.vapiFunction.get_employee_record({
      name: employee.name
    });
    console.log('   Result:', employeeRecord);

    // Test log_absence
    console.log('\n📋 Test 2: log_absence');
    const absenceResult = await vapiService.vapiFunction.log_absence({
      employee_id: employee.employee_id,
      type: 'sick',
      reason: 'Test absence - feeling unwell',
      expected_return: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      work_station: employee.work_station
    });
    console.log('   Result:', absenceResult);

    // Verify the absence was saved
    console.log('\n📋 Test 3: Verify absence was saved to database');
    const savedAbsences = await Absence.find({ employee_id: employee._id })
      .sort({ created_at: -1 })
      .limit(1);

    if (savedAbsences.length > 0) {
      console.log('   ✅ Absence found in database:');
      console.log('      Employee:', savedAbsences[0].employee_name);
      console.log('      Type:', savedAbsences[0].type);
      console.log('      Reason:', savedAbsences[0].reason);
      console.log('      Call Time:', savedAbsences[0].call_time);
      console.log('      Points:', savedAbsences[0].points_awarded);
      console.log('      Created At:', savedAbsences[0].created_at);
    } else {
      console.log('   ❌ No absence found in database');
    }

    // Test check_threshold_status
    console.log('\n📋 Test 4: check_threshold_status');
    const thresholdResult = await vapiService.vapiFunction.check_threshold_status({
      employee_id: employee.employee_id
    });
    console.log('   Result:', thresholdResult);

    // Check recent absences count
    console.log('\n📋 Test 5: Check all recent absences');
    const allAbsences = await Absence.find({})
      .populate('employee_id')
      .sort({ call_time: -1 })
      .limit(10);

    console.log(`   ✅ Found ${allAbsences.length} total absences in database`);
    allAbsences.forEach((absence, index) => {
      console.log(`   ${index + 1}. ${absence.employee_name} - ${absence.type} - ${new Date(absence.call_time).toLocaleString()}`);
    });

  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

async function main() {
  await connectDB();
  await testVapiLogging();

  console.log('\n✅ Tests complete!\n');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
