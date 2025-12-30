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

module.exports = exports;
