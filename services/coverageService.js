const ShiftOffer = require('../models/ShiftOffer');
const Employee = require('../models/Employee');
const Organization = require('../models/Organization');
const Supervisor = require('../models/Supervisor');
const outboundSms = require('./outboundSms');
const smsService = require('./smsService');
const { scopeQuery } = require('../utils/tenantHelper');

// Offers in these statuses represent work still in progress; everything else
// is a terminal outcome. Used both as the "already handling this absence"
// guard in startCoverage and as the cancel-target filter for corrections.
const NON_TERMINAL_STATUSES = ['open', 'claimed'];

// ── Message templates ────────────────────────────────────────────────────────
// Fixed strings, filled with data the caller already trusts (names, times
// computed from Organization.settings.shift_times). NEVER LLM-generated -
// these texts state facts (who, what shift, what time) that must not be
// hallucinated. See CLAUDE.md "Shift Coverage" section.
// NOTE on {dayLabel} vs {dayPossessive}: dayLabel is 'today' | 'tomorrow' |
// a weekday name ('Tuesday'). "a today shift" / "the tomorrow shift" are
// ungrammatical - only the weekday case reads correctly as a bare adjective
// ("a Tuesday shift"). {dayPossessive} (dayLabel + "'s") is grammatical in
// ALL three cases ("today's shift", "tomorrow's shift", "Tuesday's shift")
// and is what every template below uses in a pre-noun position. Where a
// name's own possessive already occupies that slot (e.g. "Sarah's shift"),
// dayLabel is placed trailing instead ("Sarah's shift today") to avoid a
// double possessive ("Sarah's Tuesday's shift").
const templates = {
  offer:
    "Hi {candidateName}, {dayPossessive} {dept} shift ({start} - {end}) at {orgName} is up for grabs. Reply YES to claim it, or NO if you can't.",
  claimPending:
    "Thanks {name}! You've got first dibs on {dayPossessive} {dept} shift ({start} - {end}). We're just checking with the manager - we'll text you the moment it's confirmed.",
  alreadyCovered:
    "Thanks for offering, {name} - that shift is already covered. We'll text you next time one opens up.",
  declineAck:
    "No problem, {name} - thanks for letting us know.",
  managerApprovalRequest:
    "{absentName} is out {dayLabel} ({reasonLabel}). {claimantName} has offered to cover their {dept} shift ({start} - {end}). Reply YES to approve or NO to decline.",
  managerApprovedAck:
    "Done - {claimantName} is confirmed for {absentName}'s shift {dayLabel}. We've let them know.",
  confirmedToClaimant:
    "You're confirmed, {name}! You're covering {dayPossessive} {dept} shift ({start} - {end}). Thanks for stepping up.",
  managerDeclinedAck:
    "Understood - we've let {claimantName} know. The shift is back with you to arrange manually.",
  declinedToClaimant:
    "Hi {name} - the manager is handling {dayPossessive} shift differently this time, so you're off the hook. Thanks so much for offering.",
  unfilledNotice:
    "Heads up: nobody claimed {absentName}'s {dept} shift {dayLabel} ({start} - {end}). We asked {n} teammate(s). You may need to arrange coverage manually.",
  cancelledToClaimant:
    "Hi {name} - {absentName}'s shift {dayLabel} no longer needs coverage, so you're all set. Thanks anyway for stepping up.",
  clarifyCandidate:
    "Sorry, I didn't catch that - reply YES to take {dayPossessive} shift, or NO if you can't.",
  clarifyManager:
    "Sorry - reply YES to approve {claimantName} for {absentName}'s shift, or NO to decline."
};

function fillTemplate(str, vars = {}) {
  const withDerived = { ...vars };
  if (withDerived.dayLabel && withDerived.dayPossessive === undefined) {
    withDerived.dayPossessive = `${withDerived.dayLabel}'s`;
  }
  return str.replace(/\{(\w+)\}/g, (_, key) => (withDerived[key] !== undefined && withDerived[key] !== null ? withDerived[key] : ''));
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'there';
}

// ── Reply parsing ────────────────────────────────────────────────────────────
// Code-first, on purpose: these are yes/no answers, not free-form absence
// reports, so a full LLM round-trip is unnecessary latency and cost for the
// overwhelming majority of replies. Anchored FULL-MATCH (not substring) is
// what keeps "I can't come in tomorrow" out of the NO bucket - it doesn't
// match either set, so it falls through as 'unclear', and the absence-keyword
// guard in isShortOfferReply keeps it from reaching the coverage-reply LLM
// at all - it's meant to fall through to the normal absence flow.
const YES_RE = /^(y|ya|yes+|yess?ir+|yea+h*|yep|yup|yuh|sure( thing)?|ok(ay)?|k+|bet|down|absolutely|definitely|deff?|for sure|fs|i'?m (down|in)|count me in|i got (you|u|it|this)|i'?ll (take|do|cover) (it|that|the shift)|take it|i can( do it| cover| take it)?|claim(ing)?( it)?|yes please|sounds good|will do)$/i;

const NO_RE = /^(n|no+|nope+|nah+|naw|negative|can'?t( sorry)?|sorry,? (i )?can'?t|sorry|cannot|not (this time|today|able to)|unable( to)?|pass( this time)?|i'?m (good|out|busy)|busy( that day)?|no can do|not available|unavailable|working( that day)?|got (work|plans))$/i;

// A message that LOOKS like an absence report must never be swallowed by the
// offer/approval reply handling - it needs to fall through to the real
// absence parser (e.g. "I can't come in tomorrow" sent by someone who also
// happens to have a pending offer).
const ABSENCE_KEYWORDS_RE = /\b(come in|coming in|make it in|be in|late|sick|appointment|leaving early|call(ing)? (out|in)|tomorrow|today|shift start|out (today|tomorrow))\b/i;

function normalizeReply(text) {
  return String(text || '')
    .replace(/[\u{1F300}-\u{1FAFF}✀-➿]/gu, '') // strip emoji
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns 'yes' | 'no' | 'unclear'. Never throws.
exports.parseYesNo = (text) => {
  const t = normalizeReply(text).replace(/[.!]+$/, '');
  if (YES_RE.test(t)) return 'yes';
  if (NO_RE.test(t)) return 'no';
  return 'unclear';
};

// Gate for whether an 'unclear' regex result is worth an LLM call at all -
// short, and not shaped like an absence report.
exports.isShortOfferReply = (text) => {
  const t = normalizeReply(text);
  return t.length <= 40 && t.split(/\s+/).length <= 6 && !ABSENCE_KEYWORDS_RE.test(t);
};

async function classifyReplyWithLLM(text, context, provider) {
  const model = provider === 'openai'
    ? (process.env.OPENAI_COVERAGE_MODEL || 'gpt-4o-mini')
    : (process.env.ANTHROPIC_COVERAGE_MODEL || 'claude-haiku-4-5-20251001');

  const situation = context === 'approval'
    ? "approve a shift swap (a coworker covering someone else's shift)"
    : "claim an open shift that a coworker can't work";

  const prompt = `Someone was asked to reply YES or NO to ${situation}.
Their reply: "${text}"

Answer with ONLY one word: yes, no, or unclear.
Slang counts - "bet", "i got you", "for sure" mean yes. "i'm good", "pass", "nah" mean no.
If they are asking a question or talking about something unrelated, answer unclear.`;

  try {
    const out = await smsService.callLLM(prompt, { provider, maxTokens: 5, model });
    const word = String(out || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return ['yes', 'no'].includes(word) ? word : 'unclear';
  } catch (err) {
    console.error('coverageService: LLM reply classification failed:', err.message);
    return 'unclear'; // fail safe: clarify, never guess
  }
}

// ── Date/time helpers ─────────────────────────────────────────────────────────
// Independent of attendanceService.getShiftStartTime, which hardcodes `new
// Date()` (today, server-local time) - see CLAUDE.md. This one is date- and
// timezone-aware because expiry needs to reason about a specific future date
// in the organization's own timezone.

function utcMidnight(d) {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

// Minutes east of UTC for `timeZone` at instant `date`.
function getTimezoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUTC - date.getTime()) / 60000;
}

// The UTC instant corresponding to a given wall-clock date/time in `timeZone`.
function localToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month, day, hour, minute, 0));
  const offset1 = getTimezoneOffsetMinutes(guess, timeZone);
  let instant = new Date(guess.getTime() - offset1 * 60000);
  const offset2 = getTimezoneOffsetMinutes(instant, timeZone);
  if (offset2 !== offset1) {
    instant = new Date(guess.getTime() - offset2 * 60000);
  }
  return instant;
}

exports.shiftStartDateTime = (dateUtcMidnight, shift, organization) => {
  const tz = organization?.settings?.timezone || 'America/New_York';
  const st = organization?.settings?.shift_times || {};
  const hhmm = { Day: st.day_start, Night: st.night_start, Weekend: st.weekend_start }[shift] || '07:00';
  const [h, m] = hhmm.split(':').map(Number);
  return localToUTC(
    dateUtcMidnight.getUTCFullYear(), dateUtcMidnight.getUTCMonth(), dateUtcMidnight.getUTCDate(),
    h, m, tz
  );
};

exports.computeExpiry = (offer, organization, now = new Date()) => {
  const windowMin = parseInt(process.env.COVERAGE_OFFER_WINDOW_MINUTES, 10) || 120;
  const byWindow = now.getTime() + windowMin * 60000;
  const byShift = exports.shiftStartDateTime(offer.date, offer.absent_employee.shift, organization).getTime();
  const floor = now.getTime() + 30 * 60000; // a same-day late report still gets 30 min
  return new Date(Math.max(floor, Math.min(byWindow, byShift)));
};

function computeDayLabel(dateUtcMidnight, now = new Date()) {
  const today = utcMidnight(now);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (dateUtcMidnight.getTime() === today.getTime()) return 'today';
  if (dateUtcMidnight.getTime() === tomorrow.getTime()) return 'tomorrow';
  return dateUtcMidnight.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}
exports.computeDayLabel = computeDayLabel;

function formatTime12h(hhmm) {
  const parts = String(hhmm || '').split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm || '';
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
exports.formatTime12h = formatTime12h;

// ── Manager resolution ───────────────────────────────────────────────────────
// Absentee's own supervisor first, falling back to the org's super admin.
// Returns the Supervisor doc if (and only if) it has a phone number, else null.
async function resolveManagerForOffer(offer, organization) {
  const employee = await Employee.findOne(scopeQuery(organization._id, { _id: offer.absent_employee.id }));
  if (!employee) return null;

  let supervisor = null;
  if (employee.supervisor_id) {
    supervisor = await Supervisor.findOne({
      _id: employee.supervisor_id, organization_id: organization._id, is_active: true
    });
  }
  if (!supervisor?.phone && organization.super_admin_id) {
    const superAdmin = await Supervisor.findOne({
      _id: organization.super_admin_id, organization_id: organization._id, is_active: true
    });
    if (superAdmin?.phone) supervisor = superAdmin;
  }
  return supervisor?.phone ? supervisor : null;
}

async function notifyUnfilled(offer) {
  const organization = await Organization.findById(offer.organization_id);
  const manager = await resolveManagerForOffer(offer, organization);
  if (!manager) return; // no phone to notify; offer is still visible on the dashboard

  const body = fillTemplate(templates.unfilledNotice, {
    absentName: firstName(offer.absent_employee.name),
    dayLabel: offer.day_label,
    dept: offer.absent_employee.department,
    start: offer.shift_start,
    end: offer.shift_end,
    n: (offer.candidates || []).length
  });

  try {
    await outboundSms.send({ to: manager.phone, body });
  } catch (err) {
    await ShiftOffer.updateOne(
      { _id: offer._id },
      { $push: { send_errors: { phone: manager.phone, error: String(err.message || err), at: new Date() } } }
    );
  }
}

// ── Candidate matching ───────────────────────────────────────────────────────
exports.findCandidates = async (employee, organizationId) => {
  if (!employee.department) return [];
  return Employee.find(scopeQuery(organizationId, {
    department: employee.department,
    _id: { $ne: employee._id }
  }));
};

// ── Core entry point ─────────────────────────────────────────────────────────
exports.startCoverage = async ({ absence, employee, organization, trigger = 'sms_auto' }) => {
  if (trigger === 'sms_auto' && process.env.COVERAGE_ENABLED !== 'true') {
    return null; // feature dormant
  }

  const existing = await ShiftOffer.findOne({
    absence_id: absence._id,
    status: { $in: NON_TERMINAL_STATUSES }
  });
  if (existing) return existing;

  const date = utcMidnight(absence.date);
  const dayLabel = computeDayLabel(date);
  const shiftTimes = organization?.settings?.shift_times || {};
  const startKey = { Day: 'day_start', Night: 'night_start', Weekend: 'weekend_start' }[employee.shift];
  const endKey = { Day: 'day_end', Night: 'night_end', Weekend: 'weekend_end' }[employee.shift];
  const shiftStart = formatTime12h(shiftTimes[startKey] || '07:00');
  const shiftEnd = formatTime12h(shiftTimes[endKey] || '15:00');
  const reasonLabel = absence.type === 'sick' ? 'sick' : 'personal';

  const now = new Date();
  const offer = new ShiftOffer({
    organization_id: organization._id,
    absence_id: absence._id,
    absent_employee: {
      id: employee._id, name: employee.name, shift: employee.shift, department: employee.department || null
    },
    date, day_label: dayLabel, shift_start: shiftStart, shift_end: shiftEnd, reason_label: reasonLabel,
    status: 'open',
    trigger,
    expires_at: now
  });
  offer.expires_at = exports.computeExpiry(offer, organization, now);

  const candidates = await exports.findCandidates(employee, organization._id);
  if (candidates.length === 0) {
    offer.status = 'unfilled';
    await offer.save();
    await notifyUnfilled(offer);
    return offer;
  }

  offer.candidates = candidates.map(c => ({
    employee_id: c._id, name: c.name, phone: c.phone,
    phone_last10: outboundSms.last10(c.phone), offered_at: now, response: 'pending'
  }));
  await offer.save();

  const results = await Promise.allSettled(candidates.map(c => outboundSms.send({
    to: c.phone,
    body: fillTemplate(templates.offer, {
      candidateName: firstName(c.name), dayLabel, dept: employee.department,
      start: shiftStart, end: shiftEnd, orgName: organization.name
    })
  })));

  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors.push({ phone: candidates[i].phone, error: String(r.reason?.message || r.reason), at: new Date() });
    }
  });

  if (errors.length === results.length) {
    offer.status = 'send_failed';
  }
  offer.send_errors = errors;
  await offer.save();
  return offer;
};

// ── Claim / decline (candidate side) ─────────────────────────────────────────
// The atomic op: a findOneAndUpdate guarded on {_id, status:'open'} makes ties
// structurally impossible - MongoDB serializes writes to a single document, so
// exactly one concurrent claimOffer call can see status:'open' and win.
exports.claimOffer = async (offerId, candidate) => {
  const now = new Date();
  const updated = await ShiftOffer.findOneAndUpdate(
    { _id: offerId, status: 'open' },
    {
      $set: {
        status: 'claimed',
        claimed_by: { employee_id: candidate.employee_id, name: candidate.name, phone: candidate.phone, at: now },
        'candidates.$[c].response': 'claimed',
        'candidates.$[c].responded_at': now
      }
    },
    { arrayFilters: [{ 'c.employee_id': candidate.employee_id }], new: true }
  );

  if (!updated) {
    await ShiftOffer.updateOne(
      { _id: offerId, 'candidates.employee_id': candidate.employee_id, 'candidates.response': 'pending' },
      { $set: { 'candidates.$.response': 'too_late', 'candidates.$.responded_at': now } }
    );
    return { won: false };
  }

  exports.notifyManagerOfClaim(updated).catch(err =>
    console.error('coverageService: manager notify failed:', err));
  return { won: true, offer: updated };
};

exports.declineOffer = async (offerId, candidate) => {
  const now = new Date();
  await ShiftOffer.updateOne(
    { _id: offerId, 'candidates.employee_id': candidate.employee_id },
    { $set: { 'candidates.$.response': 'declined', 'candidates.$.responded_at': now } }
  );

  const offer = await ShiftOffer.findById(offerId);
  if (offer && offer.status === 'open' && offer.candidates.every(c => c.response !== 'pending')) {
    const updated = await ShiftOffer.findOneAndUpdate(
      { _id: offerId, status: 'open' },
      { $set: { status: 'unfilled' } },
      { new: true }
    );
    if (updated) await notifyUnfilled(updated);
  }
  return { ok: true };
};

// ── Manager notify / approve / decline ───────────────────────────────────────
exports.notifyManagerOfClaim = async (offer) => {
  const organization = await Organization.findById(offer.organization_id);
  const manager = await resolveManagerForOffer(offer, organization);

  if (!manager) {
    await ShiftOffer.updateOne({ _id: offer._id }, { $set: { needs_dashboard_approval: true } });
    return { sent: false, reason: 'no_manager_phone' };
  }

  await ShiftOffer.updateOne({ _id: offer._id }, {
    $set: {
      'manager.supervisor_id': manager._id,
      'manager.name': manager.name,
      'manager.phone': manager.phone,
      'manager.phone_last10': outboundSms.last10(manager.phone),
      'manager.notified_at': new Date()
    }
  });

  const body = fillTemplate(templates.managerApprovalRequest, {
    absentName: firstName(offer.absent_employee.name),
    dayLabel: offer.day_label,
    reasonLabel: offer.reason_label,
    claimantName: firstName(offer.claimed_by.name),
    dept: offer.absent_employee.department,
    start: offer.shift_start,
    end: offer.shift_end
  });

  try {
    await outboundSms.send({ to: manager.phone, body });
    return { sent: true };
  } catch (err) {
    await ShiftOffer.updateOne(
      { _id: offer._id },
      { $push: { send_errors: { phone: manager.phone, error: String(err.message || err), at: new Date() } } }
    );
    return { sent: false, reason: 'send_failed' };
  }
};

exports.approveOffer = async (offerId, { via = 'dashboard' } = {}) => {
  const now = new Date();
  const updated = await ShiftOffer.findOneAndUpdate(
    { _id: offerId, status: 'claimed' },
    { $set: { status: 'approved', 'manager.response': 'approved', 'manager.responded_at': now, 'manager.via': via } },
    { new: true }
  );
  if (!updated) return { ok: false, reason: 'not_claimed' };

  if (updated.claimed_by?.phone) {
    outboundSms.send({
      to: updated.claimed_by.phone,
      body: fillTemplate(templates.confirmedToClaimant, {
        name: firstName(updated.claimed_by.name), dayLabel: updated.day_label,
        dept: updated.absent_employee.department, start: updated.shift_start, end: updated.shift_end
      })
    }).catch(err => console.error('coverageService: claimant confirm send failed:', err));
  }
  return { ok: true, offer: updated };
};

exports.declineByManager = async (offerId, { via = 'dashboard' } = {}) => {
  const now = new Date();
  const updated = await ShiftOffer.findOneAndUpdate(
    { _id: offerId, status: 'claimed' },
    { $set: { status: 'declined_by_manager', 'manager.response': 'declined', 'manager.responded_at': now, 'manager.via': via } },
    { new: true }
  );
  if (!updated) return { ok: false, reason: 'not_claimed' };

  if (updated.claimed_by?.phone) {
    outboundSms.send({
      to: updated.claimed_by.phone,
      body: fillTemplate(templates.declinedToClaimant, {
        name: firstName(updated.claimed_by.name), dayLabel: updated.day_label
      })
    }).catch(err => console.error('coverageService: claimant decline-notice send failed:', err));
  }
  return { ok: true, offer: updated };
};

// ── Webhook lookups ───────────────────────────────────────────────────────────
exports.findOfferAwaitingManager = async (phoneLast10) => {
  return ShiftOffer.findOne({
    status: 'claimed',
    'manager.phone_last10': phoneLast10,
    'manager.response': null
  }).sort({ createdAt: -1 });
};

exports.findOfferForCandidatePhone = async (phoneLast10) => {
  return ShiftOffer.findOne({
    status: { $in: ['open', 'claimed'] },
    candidates: { $elemMatch: { phone_last10: phoneLast10, response: 'pending' } }
  }).sort({ createdAt: -1 });
};

// ── Reply handlers (return {handled, reply}; routes/sms.js turns `reply` into
//    the TwiML response, and falls through to the absence flow when
//    handled===false) ─────────────────────────────────────────────────────────
exports.handleCandidateReply = async ({ offer, phoneLast10, messageBody, provider }) => {
  const candidate = offer.candidates.find(c => c.phone_last10 === phoneLast10 && c.response === 'pending');
  if (!candidate) return { handled: false, reply: null };

  let answer = exports.parseYesNo(messageBody);

  if (answer === 'unclear') {
    if (!exports.isShortOfferReply(messageBody)) {
      return { handled: false, reply: null }; // looks like an absence report - fall through
    }
    answer = await classifyReplyWithLLM(messageBody, 'offer', provider);
  }

  if (answer === 'yes') {
    const result = await exports.claimOffer(offer._id, candidate);
    return {
      handled: true,
      reply: fillTemplate(result.won ? templates.claimPending : templates.alreadyCovered, {
        name: firstName(candidate.name), dayLabel: offer.day_label,
        dept: offer.absent_employee.department, start: offer.shift_start, end: offer.shift_end
      })
    };
  }

  if (answer === 'no') {
    await exports.declineOffer(offer._id, candidate);
    return { handled: true, reply: fillTemplate(templates.declineAck, { name: firstName(candidate.name) }) };
  }

  return { handled: true, reply: fillTemplate(templates.clarifyCandidate, { dayLabel: offer.day_label }) };
};

exports.handleManagerReply = async ({ offer, messageBody, provider }) => {
  let answer = exports.parseYesNo(messageBody);
  if (answer === 'unclear' && exports.isShortOfferReply(messageBody)) {
    answer = await classifyReplyWithLLM(messageBody, 'approval', provider);
  }

  if (answer === 'yes') {
    await exports.approveOffer(offer._id, { via: 'sms' });
    return {
      handled: true,
      reply: fillTemplate(templates.managerApprovedAck, {
        claimantName: firstName(offer.claimed_by.name), absentName: firstName(offer.absent_employee.name),
        dayLabel: offer.day_label
      })
    };
  }

  if (answer === 'no') {
    await exports.declineByManager(offer._id, { via: 'sms' });
    return { handled: true, reply: fillTemplate(templates.managerDeclinedAck, { claimantName: firstName(offer.claimed_by.name) }) };
  }

  return {
    handled: true,
    reply: fillTemplate(templates.clarifyManager, {
      claimantName: firstName(offer.claimed_by.name), absentName: firstName(offer.absent_employee.name)
    })
  };
};

// ── Lifecycle: expiry sweep + cancellation ───────────────────────────────────
exports.expireOpenOffers = async (now = new Date()) => {
  const stale = await ShiftOffer.find({ status: 'open', expires_at: { $lte: now } }).limit(50);
  const expired = [];
  for (const doc of stale) {
    // Atomic guard: if two sweep ticks somehow overlap, only one notifies.
    const updated = await ShiftOffer.findOneAndUpdate(
      { _id: doc._id, status: 'open' },
      { $set: { status: 'unfilled' } },
      { new: true }
    );
    if (updated) {
      await notifyUnfilled(updated);
      expired.push(updated._id);
    }
  }
  return expired;
};

exports.cancelOfferForAbsence = async (absenceId, reason = 'cancelled') => {
  const offer = await ShiftOffer.findOne({ absence_id: absenceId, status: { $in: NON_TERMINAL_STATUSES } });
  if (!offer) return null;

  const wasClaimed = offer.status === 'claimed';
  const claimant = offer.claimed_by;

  const updated = await ShiftOffer.findOneAndUpdate(
    { _id: offer._id, status: { $in: NON_TERMINAL_STATUSES } },
    { $set: { status: 'cancelled' } },
    { new: true }
  );
  if (!updated) return null;

  if (wasClaimed && claimant?.phone) {
    outboundSms.send({
      to: claimant.phone,
      body: fillTemplate(templates.cancelledToClaimant, {
        name: firstName(claimant.name), absentName: firstName(offer.absent_employee.name), dayLabel: offer.day_label
      })
    }).catch(err => console.error('coverageService: cancel notice send failed:', err));
  }
  return updated;
};

exports.templates = templates;
exports.fillTemplate = fillTemplate;
