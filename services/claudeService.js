const Anthropic = require('@anthropic-ai/sdk');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const WorkStation = require('../models/WorkStation');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Generate individual employee report
exports.generateEmployeeReport = async (employeeId, startDate, endDate) => {
  // 1. Fetch employee data
  const employee = await Employee.findById(employeeId)
    .populate('supervisor_id');

  if (!employee) {
    throw new Error('Employee not found');
  }

  // 2. Fetch absences in date range
  const absences = await Absence.find({
    employee_id: employeeId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: -1 });

  // 3. Fetch work station data
  const station = await WorkStation.findOne({
    name: employee.work_station
  }).populate('primary_worker backup_workers');

  // 4. Build prompt for Claude
  const prompt = `
Analyze this employee's attendance record and provide insights:

**EMPLOYEE:**
Name: ${employee.name}
Employee ID: ${employee.employee_id}
Department: ${employee.department}
Work Station: ${employee.work_station || 'Not assigned'}
Shift: ${employee.shift}
Current Points: ${employee.points_current_quarter}/6.0
Status: ${employee.status}

**ABSENCES (${absences.length} total):**
${absences.map(a => `
- ${a.date.toDateString()}: ${a.type} (${a.reason})
  Points: ${a.points_awarded}
  ${a.coaching_offered ? 'Coaching offered: ' + a.employee_response : ''}
`).join('\n')}

**WORK STATION CONTEXT:**
Station: ${station ? station.name : 'Not assigned'}
Critical for production: ${station ? (station.required_for_production ? 'Yes' : 'No') : 'N/A'}
Backup coverage: ${station ? station.backup_workers.length + ' backup(s)' : 'N/A'}

**ANALYSIS REQUIRED:**

1. **Summary**: Brief overview of attendance (2-3 sentences)

2. **Pattern Detection**: Identify any concerning patterns:
   - Day-of-week patterns (e.g., frequent Monday/Friday absences)
   - Pre/post-holiday patterns
   - Timing patterns (always calls in late, etc.)
   - Clustering (multiple absences in short period)

3. **Work Station Impact**: How have these absences affected production?

4. **Risk Assessment**:
   - Current risk level (low/medium/high)
   - Likelihood of reaching termination threshold
   - Any red flags

5. **Recommendations**: Specific, actionable recommendations for supervisor:
   - Should they schedule a conversation?
   - Any support that might help?
   - Cross-training needs?
   - Policy enforcement needed?

Format as a professional management report.
  `;

  // 5. Call Claude API
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  // 6. Return formatted report
  return {
    employee,
    absences,
    station,
    analysis: message.content[0].text,
    generated_at: new Date()
  };
};

// Generate team report
exports.generateTeamReport = async (supervisorId, startDate, endDate) => {
  // 1. Get all employees under this supervisor
  const employees = await Employee.find({
    supervisor_id: supervisorId
  }).sort({ points_current_quarter: -1 });

  // If no supervisor assigned, get all employees
  const allEmployees = employees.length > 0 ? employees : await Employee.find({}).sort({ points_current_quarter: -1 });

  // 2. Get all absences for these employees
  const employeeIds = allEmployees.map(e => e._id);
  const absences = await Absence.find({
    employee_id: { $in: employeeIds },
    date: { $gte: startDate, $lte: endDate }
  });

  // 3. Get work station data
  const stations = await WorkStation.find({})
    .populate('primary_worker backup_workers');

  // 4. Calculate statistics
  const stats = {
    total_employees: allEmployees.length,
    total_absences: absences.length,
    at_risk: allEmployees.filter(e => e.status === 'at_risk').length,
    review_required: allEmployees.filter(e => e.status === 'review_required').length,
    good_standing: allEmployees.filter(e => e.status === 'good').length
  };

  // Station impact analysis
  const stationImpact = stations.map(station => {
    const stationAbsences = absences.filter(a =>
      a.work_station === station.name
    );
    return {
      station: station.name,
      days_down: stationAbsences.length,
      has_backup: station.backup_workers.length > 0
    };
  }).sort((a, b) => b.days_down - a.days_down);

  // 5. Build prompt for Claude
  const prompt = `
Analyze this team's attendance for the department:

**TEAM OVERVIEW:**
Total Employees: ${stats.total_employees}
Total Absences: ${stats.total_absences}
Employees at Risk (4+ points): ${stats.at_risk}
Formal Review Required (6+ points): ${stats.review_required}
Good Standing: ${stats.good_standing}

**TOP EMPLOYEES BY POINTS:**
${allEmployees.slice(0, 10).map(e => `
- ${e.name} (${e.employee_id}): ${e.points_current_quarter} points, ${e.absences_this_quarter} absences
  Status: ${e.status}, Station: ${e.work_station || 'Not assigned'}
`).join('\n')}

**WORK STATION IMPACT:**
${stationImpact.slice(0, 5).map(s => `
- ${s.station}: ${s.days_down} days down, ${s.has_backup ? 'HAS backup' : '⚠️ NO backup'}
`).join('\n')}

**ANALYSIS REQUIRED:**

1. **Executive Summary**: 3-4 sentence overview of team attendance health

2. **Priority Concerns**: Top 3-5 issues requiring immediate attention

3. **Station Coverage**: Which stations need backup workers or cross-training?

4. **Trends**: Any department-wide patterns or concerns?

5. **Action Items**: Specific recommendations for supervisor (prioritized)

Format as a concise management report suitable for quick review.
  `;

  // 6. Call Claude API
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  // 7. Return formatted report
  return {
    stats,
    employees: allEmployees,
    stationImpact,
    analysis: message.content[0].text,
    generated_at: new Date()
  };
};

// Generate work station downtime report
exports.generateStationReport = async (department, startDate, endDate) => {
  // 1. Get all stations for department
  const stations = await WorkStation.find({ department })
    .populate('primary_worker backup_workers');

  // If no department specified, get all stations
  const allStations = stations.length > 0 ? stations : await WorkStation.find({}).populate('primary_worker backup_workers');

  // 2. Get absences affecting these stations
  const stationNames = allStations.map(s => s.name);
  const absences = await Absence.find({
    work_station: { $in: stationNames },
    date: { $gte: startDate, $lte: endDate }
  }).populate('employee_id');

  // 3. Calculate station metrics
  const stationMetrics = allStations.map(station => {
    const stationAbsences = absences.filter(a =>
      a.work_station === station.name
    );

    return {
      name: station.name,
      days_down: stationAbsences.length,
      primary_worker: station.primary_worker?.name || 'Unassigned',
      primary_absence_rate: station.primary_worker ?
        (stationAbsences.filter(a =>
          a.employee_id?._id?.toString() === station.primary_worker._id.toString()
        ).length / (stationAbsences.length || 1) * 100) : 0,
      backup_count: station.backup_workers.length,
      critical: station.required_for_production,
      absences: stationAbsences
    };
  }).sort((a, b) => b.days_down - a.days_down);

  // 4. Build prompt for Claude
  const prompt = `
Analyze work station downtime for ${department || 'all'} department(s):

**STATIONS RANKED BY DOWNTIME:**
${stationMetrics.map((s, idx) => `
${idx + 1}. ${s.name}
   Days Down: ${s.days_down}
   Primary Worker: ${s.primary_worker}
   Backup Coverage: ${s.backup_count} worker(s)
   Critical for Production: ${s.critical ? 'YES ⚠️' : 'No'}
   Primary Worker Absence Rate: ${s.primary_absence_rate.toFixed(1)}%
`).join('\n')}

**ANALYSIS REQUIRED:**

1. **Overview**: Summary of station reliability (2-3 sentences)

2. **Critical Gaps**: Identify stations with high risk:
   - High downtime + no backup = URGENT
   - Critical stations with single point of failure
   - Stations where primary worker is frequently absent

3. **Recommendations**:
   - Which stations need backup workers assigned?
   - Cross-training opportunities
   - Should any primary assignments be reconsidered?
   - Any production planning implications?

Format as an operational report for production management.
  `;

  // 5. Call Claude API
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  return {
    stationMetrics,
    analysis: message.content[0].text,
    generated_at: new Date()
  };
};

module.exports = exports;
