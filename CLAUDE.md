# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Felton Attendance ("Hotline BLING" in the UI) is an AI-powered attendance system for Felton Brushes. Employees report absences by SMS; an LLM parses the message into a structured record over a multi-turn conversation. Supervisors manage employees, notes and reports through a web dashboard.

A second capability, **shift coverage**, builds on that: when a full-day absence is reported, the system finds a same-department teammate to cover it, texts them, and routes manager approval — all before the manager has to make a single call. See *Shift Coverage* below. It ships **disabled by default** (`COVERAGE_ENABLED=false`) pending a real Twilio Account SID.

**Stack:** Node.js, Express, MongoDB (Mongoose), EJS templates, Twilio (inbound SMS), Anthropic + OpenAI SDKs
**Building Framework:** MVC

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Development server with hot reload (port 3000)
npm start            # Production server
npm run test:sms     # Replay SMS conversations against the real parser (no DB writes)
npm run test:coverage # Shift-coverage state machine against a real scratch org (auto-cleaned)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  SMS (Twilio) → /api/sms/incoming → smsService (LLM)        │
│                         ↓                                    │
│         ConversationState (15-min TTL) ⇄ follow-up questions │
│                         ↓                                    │
│              Absence record created in MongoDB               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Web Dashboard (EJS) ← Express Routes ← Services ← MongoDB  │
└─────────────────────────────────────────────────────────────┘
```

### Key Services

- **smsService.js** — Everything SMS: conversation state, LLM parsing, merge precedence, absence creation, and the employee-facing question/confirmation wording. `routes/sms.js` is its only consumer.
- **claudeService.js** — On-demand employee report generation (see *Known Broken* below).
- **attendanceService.js** — Today's summary, shift start times, 30-minute notice check.
- **coverageService.js** — Shift-coverage state machine: candidate matching, atomic claim, manager approval, expiry, message templates. See *Shift Coverage* below.
- **outboundSms.js** — The only code path that sends outbound SMS (everything else replies to Twilio's inbound webhook). Dependency-injectable (`_setImplementation`) for tests.
- **coverageScheduler.js** — In-process `setInterval` sweep for expired offers; started from `server.js`, only when `COVERAGE_ENABLED=true`.

### LLM Provider Switching

Per-organization via `Organization.settings.llm_provider` (`claude` | `openai`), toggled by a super admin on the Account Settings page. Both `smsService.js` and `claudeService.js` have a local `callLLM(prompt, { provider, maxTokens })` helper — **add new LLM calls through it**, never by calling a vendor SDK directly, or the setting silently stops applying.

Providers do not behave identically. Any behavior that must be guaranteed belongs in code, not in the prompt (see *Ask, Don't Assume*).

Both `callLLM`s also accept a `model` override (`callLLM(prompt, { provider, maxTokens, model })`), independent of the org-level provider choice. `coverageService` uses this to run its yes/no reply classification on `ANTHROPIC_COVERAGE_MODEL` / `OPENAI_COVERAGE_MODEL` (cheap models) while absence parsing keeps using the `ANTHROPIC_MODEL` / `OPENAI_MODEL` default. **Do not casually change the absence-parsing default** — see *Model choice is gated*, below.

### Multi-Tenancy (Critical)

All data is scoped by `organization_id`. Always use helpers from `utils/tenantHelper.js`:

```javascript
const { scopeQuery, validateTenantAccess } = require("../utils/tenantHelper");

// Querying - always scope to organization
const employees = await Employee.find(scopeQuery(req.organizationId));

// Accessing single resource - validate tenant ownership
const employee = await validateTenantAccess(Employee, id, req.organizationId);
```

Exception: the SMS webhook looks employees up by phone number **before** any org context exists (`Employee.phone` is globally unique), then derives the org from `employee.organization_id`.

### Authentication Middleware

Use `requireTenantAuth` for protected routes (combines: authenticated + active + organization attached):

```javascript
const { requireTenantAuth } = require("../middleware/auth");
router.use(requireTenantAuth);
```

Role-based: `ensureAdmin`, `ensureSuperAdmin` from same file.

**Employees have no accounts.** Only `Supervisor` has credentials. The employee side is authenticated purely by possession of a phone number — relevant to any feature that would need an employee login.

## Data Models

| Model             | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| Employee          | Profiles with phone, shift, department, organization_id       |
| Supervisor        | Admin accounts with role, phone, organization_id              |
| Organization      | Tenant config: LLM provider, timezone, shift times, departments |
| Absence           | Attendance records with type, reason, transcript              |
| EmployeeNote      | Supervisor notes timeline + file attachments                  |
| ConversationState | SMS conversation context, 15-min TTL, post-log correction window |
| ShiftOffer        | Shift-coverage state machine — see *Shift Coverage*            |

### Absence Types

**SMS-reported:** `sick`, `late`, `personal`
**Admin-logged:** `no_sms_no_show`, `late_sms_no_show`, `left_early_no_permission`, `left_early_permission`, `late_in_no_sms`

The LLM's internal `type` values (`late`, `short_absence`, `half_day`, `full_day`, `unclear`, `unclear_duration`) are **not** the DB enum — `logAbsenceFromSMS` maps them plus `subtype` onto the three SMS types above.

### Duration Classification

`classifyAbsenceByDuration()` in `smsService.js` is the single authority:

- `< 120 min` → `short_absence`
- `120–240 min` → `half_day`
- `> 240 min` → `full_day`

`late` is an arrival delay at shift start and is **never** reclassified by duration. The 240-minute boundary is inclusive of `half_day` to match the "half day appointment" few-shot; the prose elsewhere says "4+ hours = full day", so this is a deliberate tie-break, not a bug.

## SMS Conversation Engine

The highest-risk area of the codebase. Read this before touching `smsService.js`.

### Conversation state field names are snake_case

The Mongoose schema defines `collected_info` and `last_question_asked`. Reading `collectedInfo` / `lastQuestionAsked` returns `undefined` **silently** — no crash, no warning. This once disabled conversation memory entirely and produced an infinite question loop in production. Writes were correct the whole time; only reads were wrong, which is why it looked functional.

### mergeCollectedInfo is the single source of truth

`parseAttendanceMessage` (in-request), `updateConversationState` (persistence) and the test harness all merge through `mergeCollectedInfo(stored, incoming, opts)`. Do not hand-roll merge logic anywhere. The rules:

- Ambiguous values (`null`, `""`, the string `"null"`, `unclear`, `unclear_duration`) **never** overwrite an established concrete value.
- Concrete values **do** overwrite — employees must be able to correct us.
- When `lastQuestionAsked` is `reason` or `duration`, an incoming `type` is **ignored**. The reply is a fragment answering our question; re-classifying from it is what caused "I have an appointment" to be read as an arrival delay and wipe out an established full-day absence.
- `is_correction: true` from the LLM bypasses that guard so a genuine correction can re-classify.

### Ask, Don't Assume

Attendance records feed discipline, so an extra text is cheaper than a wrong record. The system asks rather than guessing when a message is genuinely unclear.

The distinction is **scope, not condition**:

- States total absence ("can't come in", "out today", "taking the day") → infer full day
- States only a condition ("I'm sick", "I have an appointment", "be there soon") → ask how long

**Structural guard, not prompt-only:** the LLM returns `duration_stated`, and code discards any duration it did not report as stated (also downgrading a `full_day` claim to `unclear_duration`). This is enforced in `parseAttendanceMessage` because providers disagree on borderline phrasings. If a model omits the flag, the fail-safe direction is to ask.

Known provider difference: Claude treats `"sick today"` as ambiguous and asks; gpt-4o treats it as a stated full day and logs. Both are defensible — the harness asserts the *safe outcome* (ask, or log with a confirmation that states the scope) rather than forcing one reading.

### Question flow

`buildFollowUpQuestion()` owns all employee-facing question wording — keep it there, not in the route, so the harness tests the real text. Order asked: `status` → `duration` → `reason` → `subtype` → `date`. `subtype` rarely fires because the reason answer usually settles sick-vs-personal.

Never ask "how late will you be?" for a `full_day` absence, or for `unclear_duration` (those are absences, not arrival delays — they get "how long will you be out?").

### Post-log correction window

After an absence is logged the conversation is **not** deleted — `markConversationLogged` keeps it for the remaining TTL with `status: 'logged'` and `last_absence_id`, because the confirmation SMS invites the employee to reply if the record is wrong. A reply judged `is_correction` deletes that absence (`undoLoggedAbsence`, scoped to the one record and that employee) and reopens collection. Anything else starts a fresh conversation.

While `status === 'logged'`, the merge starts from a **clean slate** so an unrelated new report cannot inherit the previous absence's reason or date.

## Shift Coverage

When a full-day absence is reported, the system finds a same-department teammate to cover it —
this is the second major capability alongside SMS absence reporting. Read this before touching
`coverageService.js`, `routes/coverage.js`, or the webhook routing in `routes/sms.js`.

### Deployment status

**Disabled by default** (`COVERAGE_ENABLED=false`). `startCoverage` no-ops for `trigger:
'sms_auto'` unless the flag is `'true'`; the dashboard's manual "Find coverage" button bypasses
the flag entirely (`trigger: 'manual'`), so it can be exercised even while the automatic path is
off. Blocked on a real Twilio Account SID — `outboundSms.js` is the **first** code path in this
app that ever authenticates to Twilio's REST API (see *Environment Variables*). `server.js` warns
at startup if `TWILIO_ACCOUNT_SID` doesn't start with `AC`.

### State machine

```
open ──first YES (atomic)──► claimed ──manager YES──► approved
  │                             │
  ├──expiry / all declined──► unfilled          └──manager NO──► declined_by_manager
  │
  └──absence corrected──► cancelled (from open OR claimed)
```

Every transition is a `findOneAndUpdate` guarded on the **current** status (e.g. `{_id, status:
'open'}` → `claimed`). This is what makes concurrent replies safe — two candidates texting YES
at once can only ever produce one winner, because MongoDB serializes writes to a single document.
`claimed` never auto-expires; it stays visible (and highlighted, if `needs_dashboard_approval`)
until a manager acts, via SMS or the dashboard.

### Candidate matching is a query, not a model call

`findCandidates` = "every other employee in the same `Employee.department`, same org." No
schedule/rota exists — this is a deliberate v1 scope decision, not an oversight. Manager approval
is the safety net against double-booking, not availability data.

### Templates are fixed strings — never LLM-generated

Every outbound message (`coverageService.templates`) is a template filled with data the caller
already trusts — names, department, times computed from `Organization.settings.shift_times`.
These texts state facts ("Sarah is out today", "Mary has offered to cover") that must never be
hallucinated. If you need new wording, add a template; don't build the message with an LLM call.

One template gotcha: `{dayLabel}` is `'today' | 'tomorrow' | 'Tuesday'`. "a today shift" and "the
tomorrow shift" are ungrammatical — only the weekday case reads correctly as a bare adjective.
`fillTemplate` auto-derives `{dayPossessive}` (`dayLabel + "'s"`), which is grammatical in all
three cases, for use in that position. Where a name's own possessive already occupies that slot
("Sarah's shift"), `dayLabel` goes trailing instead ("Sarah's shift today") to avoid a double
possessive ("Sarah's Tuesday's shift"). Every template call site was audited for this — if you add
a new one, pass `dayLabel` and let `fillTemplate` derive the possessive; don't hand-write "a
{dayLabel} shift".

### Reply parsing is code-first, LLM-fallback

`parseYesNo` uses anchored **full-match** regex (not substring) — this is what keeps "I can't
come in tomorrow" out of the NO bucket; it doesn't match either set, so it's `'unclear'`, and
`isShortOfferReply`'s absence-keyword guard (`come in`, `late`, `tomorrow`, …) keeps it from
reaching the coverage-reply LLM at all. It's meant to fall through to the normal absence parser.
Only short, ambiguous, non-absence-shaped replies reach `classifyReplyWithLLM`, which fails safe
to `'unclear'` (→ a clarify template) rather than guessing.

### Webhook routing precedence (`routes/sms.js`)

Checked **before** the normal absence flow, each wrapped in its own try/catch so a coverage bug
can never break absence logging:

1. **Manager approval** — phone matches a `claimed` offer's `manager.phone_last10`. Checked
   first because a supervisor's phone could coincidentally collide with an employee's. Always
   `handled: true` — never falls through.
2. **Candidate offer reply** — phone matches an `open`/`claimed` offer's pending candidate,
   **and** there's no active absence conversation with a pending question (`midQuestion` guard —
   otherwise a candidate's "yes" answering *our* question, e.g. "is this a sick day or personal?",
   would get hijacked as an offer response). `handled: false` on an absence-report-shaped
   message means it falls through to the real absence parser.
3. **Existing absence flow**, unchanged, plus two fire-and-forget hooks: `is_correction` also
   calls `cancelOfferForAbsence`; a successful `full_day` log calls `startCoverage`.

### Model choice is gated — do not casually switch

Phase 8 of the shift-coverage build tested switching the absence-parsing default to cheaper
models (`claude-haiku-4-5-20251001`, `gpt-4o-mini`), gated on the existing 17-scenario harness
passing **twice** per provider. **Both failed** — and the two failures shared one root cause:

`mergeCollectedInfo`'s "don't let an ambiguous reply overwrite an established value" protection
is only applied to the `type` field (see *SMS Conversation Engine*). On Opus/gpt-4o this doesn't
matter because they're reliable enough to correctly emit `null` for unrelated fields on an
off-topic reply. On the cheaper models it doesn't hold:

- Haiku: a junk "hi" reply after "can't come in tomorrow" was established returned a concrete
  `date: "today"` instead of `null`, silently overwriting `"tomorrow"`.
- gpt-4o-mini: "I'm sick" → "all day" resolved to `subtype: "personal"` instead of `"sick"` — the
  second turn's answer clobbered the correctly-inferred subtype from turn one.

**Absence parsing stays on Opus/gpt-4o.** Coverage's own yes/no reply classification already
uses the cheap models independently (via `ANTHROPIC_COVERAGE_MODEL`/`OPENAI_COVERAGE_MODEL`) and
isn't affected — it's a single-word classification, not multi-field JSON extraction under
conversation-state protection rules. If someone wants to retry this switch, the real fix is
extending the `lastQuestionAsked` guard in `resolveField` to every mergeable field, not just
`type` — then re-run the gate.

## Testing

`scripts/test-sms-conversation.js` replays multi-turn conversations against the real parser with a mock employee and **no database access** (`mongoose.set('bufferCommands', false)` makes any stray query fail loudly instead of hanging).

```bash
npm run test:sms                                    # all scenarios, Claude
node scripts/test-sms-conversation.js --provider=openai
node scripts/test-sms-conversation.js --scenario=reported-bug --verbose
node scripts/test-sms-conversation.js -m "I'm sick" -m "all day"   # ad-hoc replay
```

Exits 1 on any failed assertion. **Run against both providers** before shipping parser or prompt changes — the org-level setting means some tenants only ever exercise the OpenAI path. Each scenario makes 1–3 real LLM calls.

Scenarios encode past bugs (`reported-bug`, `all-day-answer`, `ambiguous-no-clobber`) and regression guards (`classic-late`, `single-turn`). Add a scenario for any conversation bug you fix.

`scripts/test-coverage-flow.js` (`npm run test:coverage`) covers the shift-coverage state
machine against a real scratch organization (created and torn down per scenario, in a
`finally`), with `outboundSms._setImplementation` capturing texts instead of sending them. Every
scenario uses clean regex-parseable yes/no replies, so it needs **no real Twilio and no real
LLM call** — it forces `COVERAGE_ENABLED=true` for the run without touching `.env`. Includes a
race-condition scenario (`Promise.all` of two simultaneous claims → exactly one winner) and an
idempotency scenario (sweep run twice → exactly one manager notification).

## Environment Variables

Required in `.env`:

- `MONGODB_URI` — MongoDB connection string
- `ANTHROPIC_API_KEY` — Claude API key
- `OPENAI_API_KEY` — OpenAI key (required only if any org uses the `openai` provider)
- `ANTHROPIC_MODEL` — optional, absence-parsing default (unset = `claude-opus-4-5-20251101`). **Do not change casually** — see *Model choice is gated*.
- `OPENAI_MODEL` — optional, absence-parsing default (unset = `gpt-4o`). Same caveat.
- `SESSION_SECRET` — Express session secret
- `PORT` — Server port (default 3000)

Shift coverage (disabled by default):

- `COVERAGE_ENABLED` — `true`/`false` (default `false`). Gates the automatic SMS trigger and the expiry sweep; the dashboard's manual "Find coverage" button works regardless.
- `COVERAGE_OFFER_WINDOW_MINUTES` — default `120`
- `COVERAGE_SWEEP_INTERVAL_MS` — default `60000`
- `ANTHROPIC_COVERAGE_MODEL` — default `claude-haiku-4-5-20251001`, used only for coverage reply classification, independent of `ANTHROPIC_MODEL`
- `OPENAI_COVERAGE_MODEL` — default `gpt-4o-mini`, same independence

`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` were unread by any code before shift coverage — all Twilio interaction was a TwiML reply on the inbound webhook, which needs no credentials. `services/outboundSms.js` is the first code path that authenticates to Twilio's REST API. **The stored `TWILIO_ACCOUNT_SID` is currently an API Key SID (`SK…`), not an Account SID (`AC…`), and outbound sends will fail authentication until it's corrected** (a valid `AC…` value is commented out in `.env`). `server.js` warns at startup if this looks wrong. Twilio trial accounts additionally only send to verified numbers.

## Deployment

**Hosted on:** [Railway.app](https://railway.app)

- Production auto-deploys from `main` branch
- Environment variables configured in Railway dashboard
- Railway proxy is trusted in production (`server.js` trusts proxy for secure cookies)
- Twilio webhook URL points to the Railway deployment
- No scheduler/cron exists anywhere in the codebase — any recurring job is new infrastructure

## Known Gotchas

### Mongoose nested paths collapse if you "simplify" them

`ConversationState.collected_info` stays a nested path only because `collected_info.type` is an object literal (`{ type: String, default: null }`). Rewriting it as `type: String` makes Mongoose treat the whole `collected_info` as a String field. Verify with `Object.keys(Model.schema.paths)` after touching it.

### Assign nested paths per-leaf, never wholesale

```javascript
// Wrong - silently drops schema defaults for any key not in the new object
doc.collected_info = { type: 'late', reason: 'Traffic' };

// Right - preserves every key
for (const field of MERGEABLE_FIELDS) doc.collected_info[field] = merged[field];
```

### Expired conversations can be revived

`getConversationState` returns `null` for an expired doc **without deleting it** (Mongo's TTL monitor only sweeps ~every 60s). `updateConversationState` therefore deletes any doc past `expires_at` before reusing it — otherwise a brand-new conversation inherits stale `collected_info`.

### Hidden form inputs still submit

Inputs hidden with `display: none` still submit their values. Check the preset explicitly:

```javascript
// Wrong - hidden inputs still have values
if (startDate && endDate) { ... }

// Right - only use custom dates when explicitly selected
if (range === 'custom' && startDate && endDate) { ... }
```

### Date range queries

MongoDB stores dates in UTC. Always use `Date.UTC()` for range calculations:

```javascript
const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
```

Absence dates are resolved by `resolveAbsenceDate(dateRef, now)` in `smsService.js` — use it rather than re-deriving "tomorrow"/weekday logic.

## Known Broken / Incomplete

Do not advertise these as features (the landing page was corrected to stop doing so).

### Points system — removed, do not reintroduce piecemeal

There is no points system. It was half-scaffolded and has been fully stripped: no
`points_current_quarter` / `absences_this_quarter` / `tardies_this_quarter` / `status` writes
on employee create, update or bulk import, no `/:id/reset-points` endpoint, and no points in
the report prompt or views. The `Employee` schema never had these fields.

If it is ever rebuilt, fix the data gap first: the system only records absences employees
**text in**. No-shows stay invisible until an admin manually logs them, so points computed on
today's data would systematically punish the employees honest enough to report.

### AI employee report — unreachable

`GET /reports/employee` renders `views/reports/employee-report.ejs`. It no longer crashes
(it previously threw a `TypeError` on `report.employee.status.replace(...)` because `status`
did not exist), but **nothing in the UI links to the route** — it is only reachable by typing
the URL with an `employeeId` query param.

### Policy violations captured but never shown

`policy_violation`, `late_notice` and `minutes_before_shift` are set on every SMS absence (30-minute notice rule in `attendanceService.checkNoticeTime`) but appear in **zero** views.

### SMS_FLOW_EXAMPLES.md is stale

It documents confirmation messages that were never built (`"+0.33 points. Total: 2.33 points. ✅ Good standing."`) and predates both the duration rules and the ask-don't-assume behavior. Treat `scripts/test-sms-conversation.js` scenarios as the accurate record of conversation behavior; that doc needs a rewrite or deletion.

### checkNoticeTime assumes the absence is today

`attendanceService.getShiftStartTime` hardcodes `new Date()`. Now that "tomorrow" dates are honored, an employee texting at 6pm about tomorrow computes roughly −660 minutes and is flagged as a policy violation despite giving 13 hours of notice. Fix by threading the absence date through.

## Claude Code Tools

Custom subagents and skills in `.claude/`:

| Tool | Type | Purpose |
|------|------|---------|
| dead-code-analyzer | Subagent | Find unused code (read-only) |
| dead-code-cleaner | Subagent | Remove confirmed dead code |
| debugger | Subagent | Systematic bug debugging |
| feature-explainer | Subagent | Explain how features work |
| brainstorm | Subagent | Explore ideas and creative applications |
| claude-md-updater | Skill | Guide for updating this file |
| market-insights | Skill | User feedback, positioning, go-to-market strategy |
| brainstorming-frameworks | Skill | Frameworks for better idea generation |
