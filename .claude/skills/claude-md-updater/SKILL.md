---
name: claude-md-updater
description: Update or improve the CLAUDE.md file. Use when adding new patterns, commands, architecture changes, or learnings to the project documentation.
---

# Updating CLAUDE.md

## Purpose of CLAUDE.md

CLAUDE.md provides guidance to future Claude Code instances working in this repository. It should contain:
- Commands for building, testing, running
- High-level architecture that requires reading multiple files to understand
- Project-specific patterns and conventions
- Non-obvious knowledge that saves time

## What to Include

### Always Include
- Build/test/lint commands
- Architecture overview (how components connect)
- Critical patterns (like multi-tenancy in this project)
- Authentication/authorization patterns
- Data models and their relationships
- Environment variables needed

### Include When Relevant
- Common debugging approaches
- Known gotchas and their solutions
- API patterns
- Key services and their responsibilities

## What NOT to Include

- Generic development practices ("write clean code")
- Obvious instructions ("provide helpful error messages")
- Information easily discoverable by reading one file
- Every file or component listed out
- Time estimates
- Sensitive information (keys, tokens)

## CLAUDE.md Structure

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
[1-2 sentences: what this project does, key tech stack]

## Commands
[Essential commands in code blocks]

## Architecture
[High-level diagram or description of how parts connect]

## Key Patterns
[Project-specific patterns that aren't obvious]

## Data Models
[Brief overview of main models and relationships]

## Environment Variables
[Required env vars without actual values]
```

## When to Update CLAUDE.md

Update when:
1. **New patterns discovered** - Like the date range bug we fixed
2. **Architecture changes** - New services, routes, or models
3. **New commands added** - Scripts, build steps
4. **Gotchas found** - Things that waste debugging time
5. **Conventions established** - Team decisions on how to do things

## How to Update

### Step 1: Read Current CLAUDE.md
```
Read the existing CLAUDE.md to understand current content
```

### Step 2: Identify What's New
Ask:
- Is this a pattern that affects multiple files?
- Would a future Claude waste time without knowing this?
- Is this project-specific (not generic best practice)?

### Step 3: Add to Appropriate Section
- Commands → Commands section
- Architecture → Architecture section
- Patterns/Conventions → Key Patterns section
- Bug fixes with learnings → Consider adding to patterns

### Step 4: Keep It Concise
- Use bullet points
- Include code examples only when helpful
- Don't repeat information from other sections

## Example Updates

### After fixing the date range bug:
```markdown
## Known Gotchas

### Form Inputs Always Submit
Hidden form inputs (with `display: none`) still submit their values.
In `routes/reports.js`, we check `range === 'custom'` before using
custom date inputs to avoid this issue.
```

### After adding a new service:
```markdown
## Key Services

- **smsService.js** - SMS parsing with Claude AI
- **claudeService.js** - Report generation
- **newService.js** - [Brief description of what it does]
```

### After establishing a convention:
```markdown
## Conventions

### Error Handling in Routes
Always wrap route handlers in try-catch and return consistent error format:
\`\`\`javascript
try {
  // handler logic
} catch (error) {
  console.error('Error in [route]:', error);
  res.status(500).json({ success: false, error: error.message });
}
\`\`\`
```

## Current CLAUDE.md Location

The file is at: `CLAUDE.md` (project root)

## Validation Checklist

Before finalizing updates, verify:
- [ ] No sensitive information included
- [ ] No generic/obvious advice
- [ ] Concise and scannable
- [ ] Code examples are minimal and helpful
- [ ] Information is project-specific
- [ ] No duplication with other sections
