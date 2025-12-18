# SMS Conversation Flow - Examples

## New System Overview

**Duration-Based Classification:**
- **< 2 hours** → LATE (0.33 points)
- **2-4 hours** → HALF DAY (0.5 points)
- **4+ hours** → FULL DAY (1.0 points)

**Key Improvements:**
✅ Natural conversation (no "how many minutes?")
✅ Understands duration from context ("3 hours", "half day")
✅ Accepts any specific reason (groceries, traffic, flu)
✅ Won't get stuck in loops
✅ Always asks for missing info conversationally

---

## Scenario 1: Employee says "I will be late this morning"

**Conversation:**
```
Employee: I will be late this morning
System: Hi Bob, how late will you be? (e.g., "30 min", "2 hours")

Employee: 30 minutes
System: Hi Bob, why are you running late? (e.g., traffic, car trouble, appointment)

Employee: Traffic
System: Got it, Bob. Logged as late (30 min). +0.33 points. Total: 2.33 points. ✅ Good standing.
```

**Result:** Late (30 min - Traffic), 0.33 points

---

## Scenario 2: User's problematic example - "3 hours. Need to do groceries."

**Conversation:**
```
Employee: I will be late this morning
System: Hi Bob, how late will you be? (e.g., "30 min", "2 hours")

Employee: 3 hours. Need to do groceries.
System: Got it, Bob. Logged as personal (half day) (3 hours). +0.5 points. Total: 2.5 points. ✅ Good standing.
```

**Result:** Personal half day (3 hours - Groceries), 0.5 points
**Why it works:** System recognizes 3 hours = half day, extracts "groceries" as reason

---

## Scenario 3: Complete information upfront

**Conversation:**
```
Employee: Running 30 min late - traffic
System: Got it, Bob. Logged as late (30 min). +0.33 points. Total: 1.33 points. ✅ Good standing.
```

**Result:** Late (30 min - Traffic), 0.33 points
**Why it works:** All info provided, no follow-up needed

---

## Scenario 4: Sick with details

**Conversation:**
```
Employee: I'm sick with the flu
System: Got it, Bob. Logged as sick. +1.0 point. Total: 3.0 points. ⚠️ WATCH - Please be mindful of attendance.
```

**Result:** Sick full day (Flu), 1.0 points
**Why it works:** "Sick" implies full day, reason provided

---

## Scenario 5: Mid-day appointment (no duration specified)

**Conversation:**
```
Employee: Need to step out for a doctor appointment
System: Hi Bob, how long will you be out? (e.g., "few hours", "half day", "all day")

Employee: Couple hours
System: Got it, Bob. Logged as personal (half day) (2 hours). +0.5 points. Total: 1.5 points. ✅ Good standing.
```

**Result:** Personal half day (2 hours - Doctor appointment), 0.5 points
**Why it works:** Reason extracted, asked for duration, understood "couple hours"

---

## Scenario 6: Vague initial message

**Conversation:**
```
Employee: Can't come in
System: Hi Bob, are you running late, calling out sick, or taking time off today?

Employee: Sick
System: Hi Bob, what's going on? (e.g., flu, headache, doctor visit)

Employee: Flu and fever
System: Got it, Bob. Logged as sick. +1.0 point. Total: 2.0 points. ✅ Good standing.
```

**Result:** Sick full day (Flu and fever), 1.0 points
**Why it works:** Step-by-step clarification, natural questions

---

## Scenario 7: Extended late (becomes half day)

**Conversation:**
```
Employee: Running late - car broke down
System: Hi Bob, how late will you be? (e.g., "30 min", "2 hours")

Employee: Probably 3 hours
System: Got it, Bob. Logged as personal (half day) (3 hours). +0.5 points. Total: 1.5 points. ✅ Good standing.
```

**Result:** Personal half day (3 hours - Car broke down), 0.5 points
**Why it works:** System auto-classifies 3 hours as half day instead of tardiness

---

## Scenario 8: Natural language duration

**Conversation:**
```
Employee: Late - overslept
System: Hi Bob, how late will you be? (e.g., "30 min", "2 hours")

Employee: Half hour
System: Got it, Bob. Logged as late (30 min). +0.33 points. Total: 1.33 points. ✅ Good standing.
```

**Result:** Late (30 min - Overslept), 0.33 points
**Why it works:** Understands "half hour" = 30 minutes

---

## Key Differences from Old System

### ❌ Old System Issues:
- Asked "how many minutes?" (too granular)
- Got stuck in loops asking same question
- Didn't understand "3 hours" as a valid response
- No concept of half-day
- Too picky about reasons

### ✅ New System Fixes:
- Asks "how late?" (conversational)
- Recognizes when info is already provided
- Understands natural duration ("3 hours", "couple hours", "half day")
- Half-day classification (2-4 hours = 0.5 points)
- Accepts any specific reason mentioned
- Never gets stuck - moves forward with conversation

---

## Points System Summary

| Duration | Classification | Points | Examples |
|----------|---------------|--------|----------|
| < 2 hours | Late/Tardy | 0.33 | "30 min late", "1 hour late" |
| 2-4 hours | Half Day | 0.5 | "3 hours", "half day", "couple hours" |
| 4+ hours / All day | Full Day | 1.0 | "All day", "not coming in", "sick" |

**Employee Status Levels:**
- 0-2.99 points: ✅ Good standing
- 3-3.99 points: ⚠️ WATCH
- 4-5.99 points: ⚠️ AT RISK
- 6+ points: ⚠️ FORMAL REVIEW REQUIRED
