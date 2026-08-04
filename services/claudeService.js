const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const Organization = require('../models/Organization');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Call the configured LLM provider and return the raw text response
async function callLLM(prompt, { provider = 'claude', maxTokens = 2000 } = {}) {
  if (provider === 'openai') {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });
    return completion.choices[0].message.content;
  }

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  });
  return message.content[0].text;
}

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

**ABSENCES (${absences.length} in this period):**
${absences.map(a => `${a.date.toLocaleDateString()}: ${a.type} - ${a.reason}`).join('\n')}

**WHAT I NEED:**

1. Quick summary (1-2 sentences max)

2. Patterns to watch:
   - List only if you see clear patterns (Monday/Friday trends, clustering, timing issues)
   - Skip this if no real patterns

3. Risk level: Low, Medium, or High
   - Any red flags?

4. What to do next:
   - Talk to them? About what specifically?
   - Any action needed now?
   - If everything's fine, just say that

Keep it short and practical. Use simple words. Skip the corporate speak.
  `;

  // 5. Call the organization's configured LLM provider
  const organization = await Organization.findById(organizationId);
  const llmProvider = organization?.settings?.llm_provider || 'claude';
  const analysis = await callLLM(prompt, { provider: llmProvider, maxTokens: 2000 });

  // 6. Return formatted report
  return {
    employee,
    absences,
    analysis,
    generated_at: new Date()
  };
};

module.exports = exports;
