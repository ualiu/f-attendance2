/**
 * SMS conversation test harness
 *
 * Replays multi-turn SMS conversations against the REAL parser (real LLM calls)
 * using a mock employee and NO database access. Use it to verify conversation
 * memory, classification and date handling without texting the Twilio number.
 *
 * Usage:
 *   node scripts/test-sms-conversation.js
 *   node scripts/test-sms-conversation.js --provider=openai
 *   node scripts/test-sms-conversation.js --scenario=reported-bug --verbose
 *   node scripts/test-sms-conversation.js --message "I can't come in tomorrow" \
 *                                         --message "I have an appointment"
 *
 * Exits 1 if any assertion fails, so it can gate a deploy.
 *
 * COST: each scenario makes 1-3 real LLM calls; a full run is ~20-25 calls.
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Tripwire: this harness must never touch MongoDB. Without this, a stray query
// would hang on Mongoose's buffer timeout instead of failing loudly.
mongoose.set('bufferCommands', false);

const smsService = require('../services/smsService');

// ── Mock data ────────────────────────────────────────────────────────────────
const MOCK_EMPLOYEE = {
  _id: 'mock-employee-id',
  name: 'Urim Aliu',
  shift: 'Day',
  phone: '5555550100',
  start_date: new Date('2024-01-15'),
  organization_id: 'mock-org-id'
};

const ORG_NAME = 'Felton Brushes';
const TIMEZONE = 'America/New_York';

function freshState() {
  return {
    messages: [],
    collected_info: {
      type: null, subtype: null, reason: null, duration_minutes: null, date: null
    },
    last_question_asked: null,
    transcript: []
  };
}

function currentTimeString(when = new Date()) {
  return when.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

// ── Conversation runner ──────────────────────────────────────────────────────
// Mirrors routes/sms.js turn-for-turn, minus Twilio and the database.
async function runConversation(messages, { provider, verbose, now }) {
  const state = freshState();
  const turns = [];
  let finalParsed = null;

  for (const text of messages) {
    const isFollowUp = state.messages.length > 0;

    // routes/sms.js pushes the message before parsing
    state.messages.push({ text, timestamp: new Date() });
    state.transcript.push({ from: 'employee', message: text, timestamp: new Date() });

    const parsed = await smsService.parseAttendanceMessage(
      text,
      MOCK_EMPLOYEE,
      ORG_NAME,
      state,
      { timezone: TIMEZONE, currentTime: currentTimeString(now) },
      provider
    );

    if (verbose) {
      console.log(`\n    [parsed] ${JSON.stringify(parsed)}`);
    }

    if (parsed.success) {
      const reply = await smsService.generateResponseMessage(MOCK_EMPLOYEE, null, parsed);
      finalParsed = parsed;
      turns.push({
        text,
        parsed,
        reply,
        resolved: true,
        resolvedDate: smsService.resolveAbsenceDate(parsed.date || 'today', now || new Date())
      });
      break; // route would log the absence and clear the conversation here
    }

    const { questionAsked, message: question } =
      smsService.buildFollowUpQuestion(parsed, MOCK_EMPLOYEE, isFollowUp);

    state.transcript.push({ from: 'system', message: question, timestamp: new Date() });

    // Mirrors updateConversationState's persistence, without the DB
    state.collected_info = smsService.mergeCollectedInfo(state.collected_info, parsed);
    state.last_question_asked = questionAsked;

    if (verbose) {
      console.log(`    [collected] ${JSON.stringify(state.collected_info)}`);
    }

    turns.push({ text, parsed, question: questionAsked, reply: question, resolved: false });
  }

  return { turns, state, finalParsed };
}

// ── Assertion helpers ────────────────────────────────────────────────────────
function makeAssert(failures) {
  return {
    eq(label, actual, expected) {
      if (actual !== expected) {
        failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    ok(label, condition) {
      if (!condition) failures.push(label);
    },
    noReplyContains(label, turns, needle) {
      const hit = turns.find(t => (t.reply || '').toLowerCase().includes(needle.toLowerCase()));
      if (hit) failures.push(`${label}: a reply contained "${needle}" -> "${hit.reply}"`);
    },
    someReplyContains(label, turns, needle) {
      const hit = turns.find(t => (t.reply || '').toLowerCase().includes(needle.toLowerCase()));
      if (!hit) failures.push(`${label}: no reply contained "${needle}"`);
    }
  };
}

// Fixed reference date so weekday assertions are deterministic.
// 2026-08-03 is a Monday.
const REF_NOW = new Date(Date.UTC(2026, 7, 3, 14, 0, 0));
const iso = d => d.toISOString().slice(0, 10);

// ── Scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS = [
  {
    name: 'reported-bug',
    describe: 'Full-day tomorrow + reason follow-up (the reported infinite loop)',
    messages: ["I can't come in tomorrow", 'I have an appointment'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('should resolve within 2 turns', !!finalParsed);
      if (!finalParsed) return;
      a.eq('type is full_day', finalParsed.type, 'full_day');
      a.eq('date is tomorrow', finalParsed.date, 'tomorrow');
      a.eq('resolves to next day', iso(turns[turns.length - 1].resolvedDate), '2026-08-04');
      a.ok('reason captured', !!finalParsed.reason);
      a.noReplyContains('must never ask how late', turns, 'how late');
    }
  },
  {
    name: 'correction',
    describe: 'Employee corrects an earlier misclassification',
    messages: ["I'll be 30 min late", "actually I can't come in at all today, family emergency"],
    now: REF_NOW,
    assert: ({ finalParsed, state }, a) => {
      const type = finalParsed ? finalParsed.type : state.collected_info.type;
      a.eq('correction flips to full_day', type, 'full_day');
    }
  },
  {
    name: 'classic-late',
    describe: 'Ordinary lateness (regression guard for the LATE path)',
    messages: ['running late', '45 min', 'traffic'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('should resolve', !!finalParsed);
      if (!finalParsed) return;
      a.eq('type is late', finalParsed.type, 'late');
      a.eq('duration is 45', finalParsed.duration_minutes, 45);
      a.someReplyContains('should ask how late', turns, 'how late');
    }
  },
  {
    name: 'single-turn',
    describe: 'Complete message resolves immediately (regression guard)',
    messages: ['Out sick with flu today'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('should resolve on turn 1', !!finalParsed);
      a.eq('exactly one turn', turns.length, 1);
      if (finalParsed) a.eq('subtype sick', finalParsed.subtype, 'sick');
    }
  },
  {
    name: 'day-is-not-a-duration',
    describe: '"sick today" must reach a SAFE outcome (ask, or log + state the scope)',
    // KNOWN PROVIDER DIFFERENCE: Claude treats "sick today" as ambiguous and asks;
    // gpt-4o treats it as a stated full day and logs. Both are defensible, so we
    // assert the guarantee the design actually makes rather than forcing one
    // reading: the employee is never left with a silent guess. Either we ask, or
    // we log AND the confirmation spells out the scope so they can correct it.
    messages: ['sick today'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      const last = turns[turns.length - 1];
      if (!finalParsed) {
        a.someReplyContains('if asking, ask how long', turns, 'how long will you be out');
        return;
      }
      a.ok('if logging, confirmation must state the scope', /all day/i.test(last.reply));
      a.ok('if logging, confirmation must invite correction', /reply/i.test(last.reply));
    }
  },
  {
    name: 'bare-condition-with-day-asks',
    describe: 'A condition plus a day, with no scope, must ask on every provider',
    messages: ['not feeling well today'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('must not infer a duration', !finalParsed);
      a.someReplyContains('should ask how long', turns, 'how long will you be out');
    }
  },
  {
    name: 'unclear-duration-wording',
    describe: 'Mid-day absence must not be asked "how late"',
    messages: ['need to step out for dentist', '3 hours'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.someReplyContains('should ask how long', turns, 'how long will you be out');
      a.noReplyContains('must not ask how late', turns, 'how late');
      if (finalParsed) a.eq('3 hours is half_day', finalParsed.type, 'half_day');
    }
  },
  {
    name: 'all-day-answer',
    describe: '"all day" must classify as full_day, not half_day',
    messages: ['out for a personal matter', 'all day'],
    now: REF_NOW,
    assert: ({ finalParsed }, a) => {
      a.ok('should resolve', !!finalParsed);
      if (!finalParsed) return;
      a.eq('type is full_day', finalParsed.type, 'full_day');
    }
  },
  {
    name: 'duration-derived',
    describe: '1-hour absence is short_absence, not blanket half_day',
    messages: ["I'll be away for an appointment", '1 hour'],
    now: REF_NOW,
    assert: ({ finalParsed }, a) => {
      a.ok('should resolve', !!finalParsed);
      if (!finalParsed) return;
      a.eq('60 min is short_absence', finalParsed.type, 'short_absence');
    }
  },
  {
    name: 'weekday-date',
    describe: 'Weekday date reference survives and resolves correctly',
    messages: ["I won't be in Monday", 'family matter'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('should resolve', !!finalParsed);
      if (!finalParsed) return;
      a.eq('date is Monday', String(finalParsed.date).toLowerCase(), 'monday');
      // REF_NOW is itself a Monday, so "Monday" means the NEXT one
      a.eq('resolves to next Monday', iso(turns[turns.length - 1].resolvedDate), '2026-08-10');
    }
  },
  {
    name: 'ambiguous-no-clobber',
    describe: 'A junk follow-up must not wipe established info',
    messages: ["I can't come in tomorrow", 'hi'],
    now: REF_NOW,
    assert: ({ state, finalParsed }, a) => {
      const type = finalParsed ? finalParsed.type : state.collected_info.type;
      const date = finalParsed ? finalParsed.date : state.collected_info.date;
      a.eq('type survives junk', type, 'full_day');
      a.eq('date survives junk', date, 'tomorrow');
    }
  },

  // ── never-assume scenarios ────────────────────────────────────────────────
  {
    name: 'vague-duration-asks',
    describe: '"a while" must NOT become 30 minutes - it must ask',
    messages: ['gonna be late, be there in a while'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('must not resolve from a vague duration', !finalParsed);
      a.someReplyContains('should ask how late', turns, 'how late');
    }
  },
  {
    name: 'vague-soon-asks',
    describe: '"soon" must NOT become 15 minutes',
    messages: ['be there soon, traffic'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('must not resolve from "soon"', !finalParsed);
      a.someReplyContains('should ask how late', turns, 'how late');
    }
  },
  {
    name: 'bare-condition-asks',
    describe: '"I\'m sick" states a condition, not a duration - must ask',
    messages: ["I'm sick"],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('must not assume all day from a bare condition', !finalParsed);
      a.someReplyContains('should ask how long', turns, 'how long will you be out');
    }
  },
  {
    name: 'explicit-absence-still-infers',
    describe: 'Stating total absence still infers full day (no extra turn)',
    messages: ["I can't come in today, flu"],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('should resolve on turn 1', !!finalParsed);
      a.eq('exactly one turn', turns.length, 1);
      if (finalParsed) {
        a.eq('type is full_day', finalParsed.type, 'full_day');
        a.eq('subtype is sick', finalParsed.subtype, 'sick');
      }
    }
  },
  {
    name: 'bare-condition-then-duration',
    describe: 'Bare condition resolves once the employee answers how long',
    messages: ["I'm sick", 'all day'],
    now: REF_NOW,
    assert: ({ finalParsed }, a) => {
      a.ok('should resolve', !!finalParsed);
      if (!finalParsed) return;
      a.eq('type is full_day', finalParsed.type, 'full_day');
      a.eq('subtype is sick', finalParsed.subtype, 'sick');
    }
  },
  {
    name: 'confirmation-states-record',
    describe: 'Confirmation must name duration, day and reason so a bad guess is visible',
    messages: ["I can't come in tomorrow", 'I have an appointment'],
    now: REF_NOW,
    assert: ({ turns, finalParsed }, a) => {
      a.ok('should resolve', !!finalParsed);
      const last = turns[turns.length - 1];
      if (!last || !last.resolved) return;
      a.ok('confirmation names the day', /tomorrow/i.test(last.reply));
      a.ok('confirmation names the scope', /all day/i.test(last.reply));
      a.ok('confirmation invites correction', /reply/i.test(last.reply));
    }
  }
];

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { provider: 'claude', scenario: null, verbose: false, messages: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--provider=')) args.provider = arg.split('=')[1];
    else if (arg.startsWith('--scenario=')) args.scenario = arg.split('=')[1];
    else if (arg === '--verbose' || arg === '-v') args.verbose = true;
    else if (arg === '--message' || arg === '-m') args.messages.push(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!['claude', 'openai'].includes(args.provider)) {
    console.error(`Unknown provider "${args.provider}". Use claude or openai.`);
    process.exit(1);
  }
  const keyVar = args.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  if (!process.env[keyVar]) {
    console.error(`${keyVar} is not set in .env`);
    process.exit(1);
  }

  console.log(`\n📱 SMS conversation harness  (provider: ${args.provider})`);
  console.log('─'.repeat(70));

  // Ad-hoc mode: replay whatever messages were passed, no assertions
  if (args.messages.length > 0) {
    console.log('\nAd-hoc conversation:\n');
    const { turns } = await runConversation(args.messages, {
      provider: args.provider, verbose: args.verbose
    });
    turns.forEach(t => {
      console.log(`  👤 ${t.text}`);
      console.log(`  🤖 ${t.reply}`);
      if (t.resolved) {
        console.log(`     └─ LOGGED: type=${t.parsed.type} subtype=${t.parsed.subtype} ` +
                    `duration=${t.parsed.duration_minutes} date=${t.parsed.date} ` +
                    `-> ${iso(t.resolvedDate)}`);
      }
    });
    console.log('');
    process.exit(0);
  }

  const toRun = args.scenario
    ? SCENARIOS.filter(s => s.name === args.scenario)
    : SCENARIOS;

  if (toRun.length === 0) {
    console.error(`No scenario named "${args.scenario}". Available:`);
    SCENARIOS.forEach(s => console.error(`  - ${s.name}`));
    process.exit(1);
  }

  let passed = 0;
  const failedScenarios = [];

  for (const scenario of toRun) {
    console.log(`\n▶ ${scenario.name} — ${scenario.describe}`);

    const failures = [];
    const a = makeAssert(failures);

    try {
      const result = await runConversation(scenario.messages, {
        provider: args.provider,
        verbose: args.verbose,
        now: scenario.now
      });

      result.turns.forEach(t => {
        console.log(`    👤 ${t.text}`);
        console.log(`    🤖 ${t.reply}`);
      });

      const last = result.turns[result.turns.length - 1];
      if (last && last.resolved) {
        console.log(`    ✔ logged: type=${last.parsed.type} subtype=${last.parsed.subtype} ` +
                    `duration=${last.parsed.duration_minutes} date=${last.parsed.date} ` +
                    `-> ${iso(last.resolvedDate)}`);
      } else {
        console.log(`    ⚠ unresolved after ${result.turns.length} turn(s)`);
      }

      scenario.assert(result, a);
    } catch (err) {
      failures.push(`threw: ${err.message}`);
    }

    if (failures.length === 0) {
      console.log('    ✅ PASS');
      passed++;
    } else {
      console.log('    ❌ FAIL');
      failures.forEach(f => console.log(`       - ${f}`));
      failedScenarios.push(scenario.name);
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`${passed}/${toRun.length} scenarios passed  (provider: ${args.provider})`);
  if (failedScenarios.length > 0) {
    console.log(`Failed: ${failedScenarios.join(', ')}`);
  }
  console.log('');

  process.exit(failedScenarios.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Harness error:', err);
  process.exit(1);
});
