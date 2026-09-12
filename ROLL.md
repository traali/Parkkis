# ROLL.md — The Chronicle of ParkkiS
Append-only record of architectural decisions, dispensations, rule amendments, and visitation verdicts.

---

## 2026-09-02 — Monastic Foundation & Shared Contract Alignment
- **Actor:** Archon & Legate
- **Action:** Established AGENTS.md, .agent/workflows, and monastery-visitor gate with ParkingRiskContract compatibility check.
- **Verdict:** PASS
- **Summary:** Aligned Parkkis with canonical shared contracts v1.0.0 for seamless, non-breaking parking safety integration with Pelipäivä.

## 2026-09-02 — Interactive MCP App Maplet Layer (Option 1)
- **Actor:** Master of Works & Cellarer
- **Action:** Created `src/mcp-app.ts` (`get_parking_maplet` tool) and `web/public/mcp-maplet.html` widget implementing `@modelcontextprotocol/ext-apps`.
- **Verdict:** PASS
- **Summary:** Standalone MapLibre GL maplet widget exposes 1-10 risk gauge and fine density to AI hosts via `ui://parkkis/maplet` while leaving existing web UI 100% intact.

## 2026-09-12 — Chapter of Faults: title + CD
- **Office / Author:** Cellarer
- **Verdict:** PASS WITH FINDINGS
- **Summary:** `<title>` is ParkkiS. Added `.github/workflows/cd.yml` (project `parkkis`). Production still lags until `CLOUDFLARE_API_TOKEN` has Account.Cloudflare Pages:Edit. Parent: traali/sports-federation#1. House: #18.

---

## Format for New Entries:
```markdown
## YYYY-MM-DD — <Title of Change>
- **Office / Author:** <Office Name>
- **Base / Commit:** <sha>
- **Verdict:** PASS | PASS WITH FINDINGS | BLOCK
- **Summary:** <1-2 sentences on what was decided or changed>
```

## 2026-09-12 — Chapter of Neighbors
- **Office / Author:** Legate
- **Verdict:** PASS
- **Summary:** Vendored check-neighbors.mjs into visit. Graph: federation.neighbors.json. 5-point HOUSE_TEST_SPEC.md. SupportedSport includes weather. Future contract/rule breaks fail closed.
