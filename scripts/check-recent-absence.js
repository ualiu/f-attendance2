const mongoose = require('mongoose');
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');
require('dotenv').config();

async function checkRecentAbsence() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get the most recent absence
    const recentAbsence = await Absence.findOne()
      .sort({ created_at: -1 })
      .populate('employee_id');

    if (!recentAbsence) {
      console.log('No absences found in database');
      return;
    }

    console.log('=== MOST RECENT ABSENCE ===');
    console.log('Created at:', recentAbsence.created_at);
    console.log('Employee:', recentAbsence.employee_name);
    console.log('Type:', recentAbsence.type);
    console.log('Reason:', recentAbsence.reason);
    console.log('Report time:', recentAbsence.report_time);
    console.log('Absence date (stored in DB):', recentAbsence.date);
    console.log('\n=== POLICY TRACKING ===');
    console.log('Minutes before shift:', recentAbsence.minutes_before_shift);
    console.log('Policy violation:', recentAbsence.policy_violation);
    console.log('Late duration (minutes):', recentAbsence.late_duration_minutes);
    console.log('Late notice flag:', recentAbsence.late_notice);

    // Check if date is today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const absenceDate = new Date(recentAbsence.date);
    absenceDate.setHours(0, 0, 0, 0);

    console.log('\n=== DATE COMPARISON ===');
    console.log('Today (00:00):', today);
    console.log('Tomorrow (00:00):', tomorrow);
    console.log('Absence date (00:00):', absenceDate);
    console.log('Is absence for today?', absenceDate >= today && absenceDate < tomorrow);

    // Get total employees in same org
    const totalEmployees = await Employee.countDocuments({
      organization_id: recentAbsence.organization_id
    });

    // Get today's absences
    const todaysAbsences = await Absence.find({
      organization_id: recentAbsence.organization_id,
      date: { $gte: today, $lt: tomorrow }
    });

    console.log('\n=== TODAY\'S SUMMARY ===');
    console.log('Total employees in org:', totalEmployees);
    console.log('Total absences for today:', todaysAbsences.length);
    console.log('Absence types:', todaysAbsences.map(a => a.type).join(', '));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkRecentAbsence();
