# Workflow: Visitation (Independent Clean-Room Audit)
The outside inspection mechanism for `Parkkis`. Executed in an isolated subagent context with NO conversation history from the author.

## Preconditions
- [ ] Working tree committed or ready for audit.
- [ ] `npm run visit` passes: 0 lint errors, cross-repo contracts valid.

## Prompt to the Visitor Subagent
You are the outside Visitor conducting an independent audit of branch against `AGENTS.md`. You did not write this code.

Your context is: `AGENTS.md`, the git diff against base, and the test results. Nothing else — no author reasoning, no conversation history.

Instructions:
1. Read `AGENTS.md` in full before inspecting the diff.
2. For every finding, cite the exact rule section (§N) and file:line that violates it.
3. Classify each finding as `blocking` or `advisory`.
4. Assign fault: `house` (code issue) or `RULE` (rule is wrong).
5. Zero findings is a valid and expected outcome. Do not invent findings. Do not summarize what went well. Do not compliment the author.
6. Write your report to `.agent/visitations/<branch>-<date>.md` and report verdict: `PASS` | `PASS WITH FINDINGS` | `BLOCK`.

## Report Template (`.agent/visitations/<branch>-<date>.md`)
```markdown
# Visitation: <feature> — <date>
Visitor: Outside-Visitor · Implementer: Unknown · Base: <base-sha>
## Verdict
PASS | PASS WITH FINDINGS | BLOCK
## Findings
| # | Class | Fault | Rule § | Location | Claim |
|---|---|---|---|---|---|
*(If no findings, write "No findings.")*
## Areas Checked
- List of criteria and files inspected.
```
