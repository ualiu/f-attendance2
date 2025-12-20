const Anthropic = require('@anthropic-ai/sdk');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Helper to scope queries by organization
const scopeQuery = (organizationId, baseQuery = {}) => {
  if (!organizationId) {
    throw new Error('organizationId is required for scoped queries');
  }
  return { ...baseQuery, organization_id: organizationId };
};

// Generate individual employee report
exports.generateEmployeeReport = async (employeeId, startDate, endDate, organizationId) => {
  // 1. Fetch employee data (tenant-scoped)
  const employee = await Employee.findOne(scopeQuery(organizationId, { _id: employeeId }))
    .populate('supervisor_id');

  if (!employee) {
    throw new Error('Employee not found');
  }

  // 2. Fetch absences in date range (tenant-scoped)
  const absences = await Absence.find(scopeQuery(organizationId, {
    employee_id: employeeId,
    date: { $gte: startDate, $lte: endDate }
  })).sort({ date: -1 });

  // 3. Build prompt for Claude
  const prompt = `
Review this employee's attendance. Be direct and concise - no fluff.

**EMPLOYEE:**
${employee.name} (${employee.employee_id})
Shift: ${employee.shift}
Started: ${employee.start_date ? new Date(employee.start_date).toLocaleDateString() : 'Unknown'}
Benefits: ${employee.vacation_days_per_year || 0} vacation, ${employee.sick_days_per_year || 0} sick, ${employee.flex_days_per_year || 0} flex days
Points: ${employee.points_current_quarter}/6.0 - Status: ${employee.status}

**ABSENCES (${absences.length} this quarter):**
${absences.map(a => `${a.date.toLocaleDateString()}: ${a.type} - ${a.reason} (${a.points_awarded} pts)`).join('\n')}

**WHAT I NEED:**

1. Quick summary (1-2 sentences max)

2. Patterns to watch:
   - List only if you see clear patterns (Monday/Friday trends, clustering, timing issues)
   - Skip this if no real patterns

3. Risk level: Low, Medium, or High
   - Will they hit 6 points soon?
   - Any red flags?

4. What to do next:
   - Talk to them? About what specifically?
   - Any action needed now?
   - If everything's fine, just say that

Keep it short and practical. Use simple words. Skip the corporate speak.
  `;

  // 5. Call Claude API (using same model as SMS service for consistency)
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  // 5. Return formatted report
  return {
    employee,
    absences,
    analysis: message.content[0].text,
    generated_at: new Date()
  };
};

// Generate team report
exports.generateTeamReport = async (supervisorId, startDate, endDate, organizationId) => {
  // 1. Get all employees under this supervisor (tenant-scoped)
  const employees = await Employee.find(scopeQuery(organizationId, {
    supervisor_id: supervisorId
  })).sort({ points_current_quarter: -1 });

  // If no supervisor assigned, get all employees in organization
  const allEmployees = employees.length > 0 ? employees :
    await Employee.find(scopeQuery(organizationId)).sort({ points_current_quarter: -1 });

  // 2. Get all absences for these employees (tenant-scoped)
  const employeeIds = allEmployees.map(e => e._id);
  const absences = await Absence.find(scopeQuery(organizationId, {
    employee_id: { $in: employeeIds },
    date: { $gte: startDate, $lte: endDate }
  }));

  // 3. Calculate statistics
  const stats = {
    total_employees: allEmployees.length,
    total_absences: absences.length,
    at_risk: allEmployees.filter(e => e.status === 'at_risk').length,
    review_required: allEmployees.filter(e => e.status === 'review_required').length,
    good_standing: allEmployees.filter(e => e.status === 'good').length
  };

  // 4. Build prompt for Claude
  const prompt = `
Analyze this team's attendance:

**TEAM OVERVIEW:**
Total Employees: ${stats.total_employees}
Total Absences: ${stats.total_absences}
Employees at Risk (4+ points): ${stats.at_risk}
Formal Review Required (6+ points): ${stats.review_required}
Good Standing: ${stats.good_standing}

**TOP EMPLOYEES BY POINTS:**
${allEmployees.slice(0, 10).map(e => `
- ${e.name} (${e.employee_id}): ${e.points_current_quarter} points, ${e.absences_this_quarter} absences
  Status: ${e.status}, Shift: ${e.shift}
`).join('\n')}

**ANALYSIS REQUIRED:**

1. **Executive Summary**: 3-4 sentence overview of team attendance health

2. **Priority Concerns**: Top 3-5 issues requiring immediate attention

3. **Trends**: Any team-wide patterns or concerns?

4. **Action Items**: Specific recommendations for supervisor (prioritized)

Format as a concise management report suitable for quick review.
  `;

  // 5. Call Claude API (using same model as SMS service for consistency)
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  // 6. Return formatted report
  return {
    stats,
    employees: allEmployees,
    analysis: message.content[0].text,
    generated_at: new Date()
  };
};

module.exports = exports;
