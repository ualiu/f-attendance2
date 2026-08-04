# SMS Conversation Flow - Examples

Every conversation below is real output captured from `scripts/test-sms-conversation.js`
running against the live parser. Run `npm run test:sms` to reproduce them.

> **There is no points system.** If you find a doc, comment or prompt mentioning points,
> statuses or quarterly thresholds, it is stale. See CLAUDE.md.

## How classification works

Duration decides the absence type (`classifyAbsenceByDuration` in `services/smsService.js`):

| Duration  | Type            |
| --------- | --------------- |
| < 2 hours | `short_absence` |
| 2-4 hours | `half_day`      |
| 4+ hours  | `full_day`      |

`late` is an arrival delay at shift start and is never reclassified by duration. These map
onto the three SMS database types (`sick`, `late`, `personal`) via `subtype`.

## The core rule: ask, don't assume

Attendance records feed discipline, so an extra text is cheaper than a wrong record. The
system infers a duration only when the message states **total absence**, and asks otherwise.
The distinction is scope, not condition:

- "can't come in" / "out today" / "taking the day" → states total absence → **infers** full day
- "I'm sick" / "I have an appointment" / "be there soon" → states a condition → **asks**

Vague durations are never converted into numbers. "a while", "soon" and "a bit" produce a
question, not a guess.

---

## Scenario 1: Full day, reported the night before

```
Employee: I can't come in tomorrow
System:   Hi John Doe, what's the reason? (e.g., appointment, errands, family matter)

Employee: I have an appointment
System:   Got it, John Doe. Logged: out all day (personal) tomorrow - Appointment. ✅
          If that's not right, just reply and tell me what to change.
```

**Result:** `full_day` / `personal` / 480 min, dated **tomorrow**

"I can't come in" states total absence, so duration is inferred and never asked for.
Answering "the reason" does not reclassify the absence — an appointment is *why* they are
missing the whole day, not evidence they are merely running late.

---

## Scenario 2: A condition with no scope

```
Employee: I'm sick
System:   Hi John Doe, how long will you be out? (e.g., "an hour", "few hours", "all day")

Employee: all day
System:   Got it, John Doe. Logged: out all day (sick) today - Sick. ✅
          If that's not right, just reply and tell me what to change.
```

**Result:** `full_day` / `sick` / 480 min / today

Being sick does not say how much work is missed — they might come in late or leave early.
The system asks rather than assuming a full day.

---

## Scenario 3: Ordinary lateness

```
Employee: running late
System:   Hi John Doe, how late will you be? (e.g., "30 min", "2 hours")

Employee: 45 min
System:   Hi John Doe, why are you running late? (e.g., traffic, car trouble, appointment)

Employee: traffic
System:   Got it, John Doe. Logged: in 45 min late today - Traffic. ✅
```

**Result:** `late` / 45 min / today

---

## Scenario 4: Everything in one message

```
Employee: Out sick with flu today
System:   Got it, John Doe. Logged: out all day (sick) today - Flu. ✅
```

**Result:** `full_day` / `sick` — resolved in a single turn, no questions asked.

---

## Scenario 5: Mid-day absence

```
Employee: need to step out for dentist
System:   Hi John Doe, how long will you be out? (e.g., "an hour", "few hours", "all day")

Employee: 3 hours
System:   Got it, John Doe. Logged: out 3 hours (personal) today - Dentist appointment. ✅
```

**Result:** `half_day` / `personal` / 180 min

Note the wording: a mid-day absence is asked **"how long will you be out?"**, never "how
late will you be?" — that phrasing is reserved for arrival delays.

---

## Scenario 6: Under two hours

```
Employee: I'll be away for an appointment
System:   Hi John Doe, how long will you be out? (e.g., "an hour", "few hours", "all day")

Employee: 1 hour
System:   Got it, John Doe. Logged: out 1 hour (personal) today - Appointment. ✅
```

**Result:** `short_absence` — 60 minutes is under the 2-hour threshold.

---

## Scenario 7: The employee corrects us

```
Employee: I'll be 30 min late
System:   Hi John Doe, why are you running late? (e.g., traffic, car trouble, appointment)

Employee: actually I can't come in at all today, family emergency
System:   Got it, John Doe. Logged: out all day (personal) today - Family emergency. ✅
```

**Result:** `full_day` — the stored `late` / 30 min is overwritten.

"actually" and "at all" signal a correction, which is the only thing allowed to reclassify
an absence mid-conversation. A correction sent *after* the record is saved deletes it and
starts over — the confirmation message invites exactly that.

---

## Scenario 8: Vague duration

```
Employee: be there soon, traffic
System:   Hi John Doe, how late will you be? (e.g., "30 min", "2 hours")
```

"Soon" is not a duration. It is never turned into 15 minutes — the system asks.

---

## Scenario 9: A future weekday

```
Employee: I won't be in Monday
System:   Hi John Doe, what's the reason? (e.g., appointment, errands, family matter)

Employee: family matter
System:   Got it, John Doe. Logged: out all day (personal) Monday - Family matter. ✅
```

**Result:** dated the **next** Monday, resolved to UTC midnight by `resolveAbsenceDate`.

---

## Conversation lifecycle

- State lives in `ConversationState`, keyed by phone number, with a 15-minute TTL.
- Established facts are sticky: an ambiguous or empty value can never overwrite a concrete
  one. Only a concrete value, or an explicit correction, can.
- After an absence is logged the conversation stays open for the rest of the TTL so a reply
  can correct the record. An unrelated new message starts a fresh conversation.
- If the same question would be asked twice, the reply is prefixed with "Sorry, I didn't
  catch that"; after several failed turns it hands off to the phone number.
