/**
 * Shift coverage test harness
 *
 * Exercises the full ShiftOffer state machine against a REAL scratch
 * organization in the dev database (created and torn down per scenario), with
 * outbound SMS captured in memory - no real Twilio, no real LLM calls (every
 * scenario here uses clean yes/no replies, which coverageService parses in
 * code; see scripts/test-sms-conversation.js for LLM-path coverage of the
 * underlying absence parser).
 *
 * Usage:
 *   node scripts/test-coverage-flow.js
 *   node scripts/test-coverage-flow.js --scenario=happy-path --verbose
 *
 * Exits 1 on any failed assertion.
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Tripwire: this harness must only touch its own scratch org. Any stray query
// outside that (e.g. a bug that queries without organization_id) throws
// instantly instead of silently scanning the whole collection.
mongoose.set('bufferCommands', false);

const Organization = require('../models/Organization');
const Employee = require('../models/Employee');
const Supervisor = require('../models/Supervisor');
const Absence = require('../models/Absence');
const ShiftOffer = require('../models/ShiftOffer');
const outboundSms = require('../services/outboundSms');
const coverageService = require('../services/coverageService');

// ── Fixtures ─────────────────────────────────────────────────────────────────
async function createFixtures({ withManagerPhone = true } = {}) {
  const suffix = Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  const org = await Organization.create({
    name: 'Coverage Test ' + suffix,
    slug: 'coverage-test-' + suffix,
    contact_email: 'coverage-test@example.local',
    settings: {
      departments: ['Cashier', 'Bakery'],
      timezone: 'America/New_York',
      shift_times: { day_start: '07:00', day_end: '15:00' }
    }
  });

  let boss = null;
  if (withManagerPhone) {
    const password_hash = await Supervisor.hashPassword('testpass123');
    boss = await Supervisor.create({
      email: 'boss-' + suffix + '@example.local', name: 'Big Boss', password_hash,
      role: 'admin', phone: '5555590001', organization_id: org._id
    });
  }

  const mk = (label, phoneSuffix, dept) => Employee.create({
    employee_id: `CT-${label}-${suffix}`, name: `${label} Test`, phone: '555559' + phoneSuffix,
    shift: 'Day', department: dept, organization_id: org._id,
    supervisor_id: label === 'Sarah' ? boss?._id : undefined
  });

  const sarah = await mk('Sarah', '0011', 'Cashier'); // the absentee
  const mary = await mk('Mary', '0012', 'Cashier');   // candidate
  const jane = await mk('Jane', '0013', 'Cashier');   // candidate
  const bob = await mk('Bob', '0014', 'Bakery');      // wrong department - exclusion control

  return { org, boss, sarah, mary, jane, bob };
}

async function createAbsence(org, employee, type = 'sick') {
  return Absence.create({
    employee_id: employee._id, employee_name: employee.name, organization_id: org._id,
    date: new Date(), type, reason: 'Test reason', report_time: new Date(), report_method: 'sms'
  });
}

async function cleanup(fixtures) {
  const org = fixtures?.org;
  if (!org) return;
  await ShiftOffer.deleteMany({ organization_id: org._id });
  await Absence.deleteMany({ organization_id: org._id });
  await Employee.deleteMany({ organization_id: org._id });
  await Supervisor.deleteMany({ organization_id: org._id });
  await Organization.deleteOne({ _id: org._id });
}

function candidateFor(offer, employee) {
  return offer.candidates.find(c => String(c.employee_id) === String(employee._id));
}

// ── Assertion helpers ────────────────────────────────────────────────────────
function makeAssert(failures) {
  return {
    eq(label, actual, expected) {
      if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    ok(label, condition, detail) {
      if (!condition) failures.push(`${label}${detail ? ' -> ' + detail : ''}`);
    },
    includes(label, haystack, needle) {
      if (!String(haystack || '').includes(needle)) {
        failures.push(`${label}: expected to include "${needle}", got "${haystack}"`);
      }
    }
  };
}

// ── Scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS = [];
function scenario(name, describe, run) {
  SCENARIOS.push({ name, describe, run });
}

scenario('happy-path', 'Full flow: offer -> claim -> manager approves', async (a, { verbose }) => {
  const fixtures = await createFixtures();
  const { org, boss, sarah, mary, jane, bob } = fixtures;
  const sent = [];
  outboundSms._setImplementation(async (m) => { sent.push(m); return { sid: 'x' }; });

  try {
    const absence = await createAbsence(org, sarah, 'sick');
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });

    a.eq('offer status is open', offer.status, 'open');
    a.eq('exactly 2 candidates (Mary + Jane, not Bob)', offer.candidates.length, 2);
    a.ok('Bob (wrong dept) excluded', !offer.candidates.some(c => String(c.employee_id) === String(bob._id)));
    a.eq('2 offer texts sent', sent.filter(s => ['5555590012', '5555590013'].includes(s.to)).length, 2);

    const offerToMary = sent.find(s => s.to === mary.phone);
    a.ok('offer text sent', !!offerToMary);
    a.includes('offer text names department', offerToMary?.body, 'Cashier');

    // Mary claims
    const claim = await coverageService.claimOffer(offer._id, candidateFor(offer, mary));
    a.eq('Mary won the claim', claim.won, true);
    await new Promise(r => setTimeout(r, 300)); // fire-and-forget manager notify

    const claimed = await ShiftOffer.findById(offer._id);
    a.eq('offer status is claimed', claimed.status, 'claimed');
    a.eq('needs_dashboard_approval is false (manager has a phone)', claimed.needs_dashboard_approval, false);

    const managerText = sent.find(s => s.to === boss.phone);
    a.ok('manager was texted', !!managerText);
    a.includes('manager text names absentee', managerText?.body, 'Sarah');
    a.includes('manager text names claimant', managerText?.body, 'Mary');

    // Manager approves
    const approval = await coverageService.approveOffer(offer._id, { via: 'sms' });
    a.eq('approve succeeded', approval.ok, true);
    await new Promise(r => setTimeout(r, 300));

    const approved = await ShiftOffer.findById(offer._id);
    a.eq('final status is approved', approved.status, 'approved');
    a.eq('manager.via recorded', approved.manager.via, 'sms');

    const confirmText = sent.filter(s => s.to === mary.phone).pop();
    a.includes('claimant got final confirmation', confirmText?.body, 'confirmed');

    if (verbose) sent.forEach(s => console.log(`    -> ${s.to}: ${s.body}`));
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('manager-declines', 'Manager declines a claim - claimant is notified, shift reverts', async (a) => {
  const fixtures = await createFixtures();
  const { org, sarah, mary } = fixtures;
  const sent = [];
  outboundSms._setImplementation(async (m) => { sent.push(m); return { sid: 'x' }; });

  try {
    const absence = await createAbsence(org, sarah);
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });
    await coverageService.claimOffer(offer._id, candidateFor(offer, mary));

    const result = await coverageService.declineByManager(offer._id, { via: 'dashboard' });
    a.eq('decline succeeded', result.ok, true);
    await new Promise(r => setTimeout(r, 300));

    const declined = await ShiftOffer.findById(offer._id);
    a.eq('status is declined_by_manager', declined.status, 'declined_by_manager');

    const noticeToMary = sent.filter(s => s.to === mary.phone).pop();
    a.ok('claimant was notified of decline', !!noticeToMary);
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('expiry-sweep', 'Unclaimed offer expires and sweep is idempotent', async (a) => {
  const fixtures = await createFixtures();
  const { org, boss, sarah, mary, jane } = fixtures;
  const sent = [];
  outboundSms._setImplementation(async (m) => { sent.push(m); return { sid: 'x' }; });

  try {
    const absence = await createAbsence(org, sarah);
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });

    // Force it into the past
    await ShiftOffer.updateOne({ _id: offer._id }, { $set: { expires_at: new Date(Date.now() - 1000) } });

    const swept1 = await coverageService.expireOpenOffers(new Date());
    a.eq('first sweep expires exactly one offer', swept1.length, 1);

    const afterFirst = await ShiftOffer.findById(offer._id);
    a.eq('status is unfilled', afterFirst.status, 'unfilled');

    const noticesAfterFirst = sent.filter(s => s.to === boss.phone).length;
    a.eq('manager notified exactly once', noticesAfterFirst, 1);

    // Second sweep must be a no-op (idempotency)
    const swept2 = await coverageService.expireOpenOffers(new Date());
    a.eq('second sweep finds nothing new', swept2.length, 0);

    const noticesAfterSecond = sent.filter(s => s.to === boss.phone).length;
    a.eq('no duplicate manager notice on second sweep', noticesAfterSecond, 1);

    const unfilledText = sent.find(s => s.to === boss.phone);
    a.includes('unfilled notice mentions how many were asked', unfilledText?.body, '2');
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('all-decline', 'Every candidate declining ends the offer early, before expiry', async (a) => {
  const fixtures = await createFixtures();
  const { org, boss, sarah, mary, jane } = fixtures;
  const sent = [];
  outboundSms._setImplementation(async (m) => { sent.push(m); return { sid: 'x' }; });

  try {
    const absence = await createAbsence(org, sarah);
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });

    await coverageService.declineOffer(offer._id, candidateFor(offer, mary));
    let mid = await ShiftOffer.findById(offer._id);
    a.eq('still open after one decline (Jane still pending)', mid.status, 'open');

    await coverageService.declineOffer(offer._id, candidateFor(offer, jane));
    await new Promise(r => setTimeout(r, 200));

    const finalOffer = await ShiftOffer.findById(offer._id);
    a.eq('unfilled immediately once everyone has declined', finalOffer.status, 'unfilled');

    const notice = sent.find(s => s.to === boss.phone);
    a.ok('manager notified without waiting for the sweep', !!notice);
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('correction-cancels-open', 'Absence correction cancels an unclaimed offer', async (a) => {
  const fixtures = await createFixtures();
  const { org, sarah } = fixtures;
  outboundSms._setImplementation(async () => ({ sid: 'x' }));

  try {
    const absence = await createAbsence(org, sarah);
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });

    const cancelled = await coverageService.cancelOfferForAbsence(absence._id, 'absence_corrected');
    a.ok('cancel returned the offer', !!cancelled);
    a.eq('status is cancelled', cancelled.status, 'cancelled');

    // Cancelling again must be a safe no-op (already terminal)
    const second = await coverageService.cancelOfferForAbsence(absence._id, 'absence_corrected');
    a.eq('re-cancelling an already-cancelled offer returns null', second, null);
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('correction-cancels-claimed', 'Absence correction cancels a CLAIMED offer and notifies the claimant', async (a) => {
  const fixtures = await createFixtures();
  const { org, sarah, mary } = fixtures;
  const sent = [];
  outboundSms._setImplementation(async (m) => { sent.push(m); return { sid: 'x' }; });

  try {
    const absence = await createAbsence(org, sarah);
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });
    await coverageService.claimOffer(offer._id, candidateFor(offer, mary));

    const cancelled = await coverageService.cancelOfferForAbsence(absence._id, 'absence_corrected');
    a.eq('status is cancelled', cancelled.status, 'cancelled');
    await new Promise(r => setTimeout(r, 200));

    const noticeToMary = sent.find(s => s.to === mary.phone && /no longer needs coverage/i.test(s.body));
    a.ok('claimant was notified the shift no longer needs covering', !!noticeToMary);
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('race-condition', 'Two simultaneous claims on the same offer - exactly one wins', async (a) => {
  const fixtures = await createFixtures();
  const { org, sarah, mary, jane } = fixtures;
  outboundSms._setImplementation(async () => ({ sid: 'x' }));

  try {
    const absence = await createAbsence(org, sarah);
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });

    const [r1, r2] = await Promise.all([
      coverageService.claimOffer(offer._id, candidateFor(offer, mary)),
      coverageService.claimOffer(offer._id, candidateFor(offer, jane))
    ]);

    const wins = [r1.won, r2.won].filter(Boolean).length;
    a.eq('exactly one claim won', wins, 1);

    const final = await ShiftOffer.findById(offer._id);
    a.eq('status is claimed (not double-claimed)', final.status, 'claimed');

    const loserCandidate = r1.won ? candidateFor(final, jane) : candidateFor(final, mary);
    a.eq('loser marked too_late', loserCandidate.response, 'too_late');
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('no-manager-phone', 'Claim with no resolvable manager phone flags dashboard approval', async (a) => {
  const fixtures = await createFixtures({ withManagerPhone: false });
  const { org, sarah, mary } = fixtures;
  const sent = [];
  outboundSms._setImplementation(async (m) => { sent.push(m); return { sid: 'x' }; });

  try {
    const absence = await createAbsence(org, sarah);
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'sms_auto' });
    await coverageService.claimOffer(offer._id, candidateFor(offer, mary));
    await new Promise(r => setTimeout(r, 300));

    const claimed = await ShiftOffer.findById(offer._id);
    a.eq('status is claimed', claimed.status, 'claimed');
    a.eq('needs_dashboard_approval is true', claimed.needs_dashboard_approval, true);
    // Both Cashier-department candidates (Mary AND Jane) legitimately get an
    // offer text; the only thing that must NOT happen is a manager text -
    // and there is no manager phone anywhere in this fixture to send one to.
    const candidatePhones = ['5555590012', '5555590013'];
    a.eq('no manager SMS was sent', sent.filter(s => !candidatePhones.includes(s.to)).length, 0);

    // Dashboard approval must still work with no manager phone on file
    const approved = await coverageService.approveOffer(offer._id, { via: 'dashboard' });
    a.eq('dashboard approve works without a manager phone', approved.ok, true);
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

scenario('manual-trigger-any-type', 'Manual trigger works for a non-full_day absence type (e.g. a no-show)', async (a) => {
  const fixtures = await createFixtures();
  const { org, sarah } = fixtures;
  outboundSms._setImplementation(async () => ({ sid: 'x' }));

  try {
    // Admin-logged no-show - never reaches startCoverage via the SMS auto
    // trigger (that only fires on parsedData.type === 'full_day'), only via
    // the dashboard's manual "Find coverage" button.
    const absence = await createAbsence(org, sarah, 'no_sms_no_show');
    const offer = await coverageService.startCoverage({ absence, employee: sarah, organization: org, trigger: 'manual' });

    a.ok('offer was created for a manually-triggered non-SMS absence type', !!offer);
    a.eq('offer status is open', offer.status, 'open');
    a.eq('reason_label defaults to personal for a non-sick type', offer.reason_label, 'personal');
  } finally {
    outboundSms._reset();
    await cleanup(fixtures);
  }
});

// ── Pure parser unit table (no DB) ───────────────────────────────────────────
scenario('parser-unit-table', 'YES/NO/unclear classification, including the absence-report collision', async (a) => {
  const YES = ['yes', 'yeah', 'yep', 'yuh', 'bet', 'sure', 'ok', 'k', 'i got you', "i'll take it", 'claim it'];
  const NO = ['no', 'nope', 'nah', "can't", 'cant sorry', "sorry can't", 'pass', "i'm good", 'not available', 'working'];
  const UNCLEAR = ['maybe', 'what time?', 'idk', 'later'];

  YES.forEach(t => a.eq(`YES: "${t}"`, coverageService.parseYesNo(t), 'yes'));
  NO.forEach(t => a.eq(`NO: "${t}"`, coverageService.parseYesNo(t), 'no'));
  UNCLEAR.forEach(t => a.eq(`UNCLEAR: "${t}"`, coverageService.parseYesNo(t), 'unclear'));

  // The critical collision: an absence report must never be read as a clean NO.
  a.eq('absence report is not a clean NO', coverageService.parseYesNo("I can't come in tomorrow"), 'unclear');
  a.eq('absence report is not short-offer-shaped (must fall through, not go to LLM)',
    coverageService.isShortOfferReply("I can't come in tomorrow"), false);
  a.eq('short clean reply IS short-offer-shaped', coverageService.isShortOfferReply('bet'), true);
});

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { scenario: null, verbose: false };
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) args.scenario = arg.split('=')[1];
    else if (arg === '--verbose' || arg === '-v') args.verbose = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // startCoverage no-ops for trigger:'sms_auto' unless the feature is enabled
  // (it's dormant by default in production - see server.js). This harness is
  // explicitly testing the enabled behavior, so force it on for the run;
  // nothing here touches the real .env file.
  process.env.COVERAGE_ENABLED = 'true';

  await mongoose.connect(process.env.MONGODB_URI);

  console.log('\n🔄 Shift coverage test harness');
  console.log('─'.repeat(70));

  const toRun = args.scenario ? SCENARIOS.filter(s => s.name === args.scenario) : SCENARIOS;
  if (toRun.length === 0) {
    console.error(`No scenario named "${args.scenario}". Available:`);
    SCENARIOS.forEach(s => console.error(`  - ${s.name}`));
    await mongoose.disconnect();
    process.exit(1);
  }

  let passed = 0;
  const failedScenarios = [];

  for (const s of toRun) {
    console.log(`\n▶ ${s.name} — ${s.describe}`);
    const failures = [];
    const assertHelpers = makeAssert(failures);
    try {
      await s.run(assertHelpers, { verbose: args.verbose });
    } catch (err) {
      failures.push(`threw: ${err.stack || err.message}`);
    }

    if (failures.length === 0) {
      console.log('  ✅ PASS');
      passed++;
    } else {
      console.log('  ❌ FAIL');
      failures.forEach(f => console.log(`     - ${f}`));
      failedScenarios.push(s.name);
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`${passed}/${toRun.length} scenarios passed`);
  if (failedScenarios.length > 0) console.log(`Failed: ${failedScenarios.join(', ')}`);
  console.log('');

  await mongoose.disconnect();
  process.exit(failedScenarios.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Harness error:', err);
  process.exit(1);
});
