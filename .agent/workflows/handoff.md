# Workflow: Handoff (Inter-Session State Transfer)

When an agent finishes a session or transfers work to another tool/session, write `.agent/handoffs/<branch>.md`.
Only files cross session boundaries.

---

## Handoff Template (`.agent/handoffs/<branch>.md`)

```markdown
# Handoff: <branch>
Date: <YYYY-MM-DD>
Author: <tool/agent>

## Goal
<What we are trying to achieve in this branch>

## Done
- <Completed changes with commit SHAs>

## In Progress
- <Half-finished items and exact current state>

## Next
1. <Immediate next action>
2. <Following action>

## Decisions & Why
- <Key architectural or implementation choices made during the session>

## Dead Ends (Crucial — Saves the most time)
- <Approaches that were tried and failed, and why they failed>

## Status
- **Lint:** PASS | FAIL
- **Tests:** PASS | FAIL (<details>)
- **Build:** PASS | FAIL
```

---

## Post-Merge Cleanup

All files in `.agent/handoffs/` are **ephemeral** and must be deleted upon branch merge.
