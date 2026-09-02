# AGENTS.md — The Rule of ParkkiS

The canonical, tool-agnostic rule for all AI agents and contributors working in `Parkkis`.

---

## §0 Precedence
1. `AGENTS.md` (this file) is the supreme project rule.
2. Native tool configs (`CLAUDE.md`, `.cursorrules`, etc.) are thin pointers to this file and must contain no independent rules.
3. In conflicts between code comments and `AGENTS.md`, `AGENTS.md` wins.

---

## §1 Identity & Architecture
- **Identity:** Spatial intelligence application for Helsinki parking safety, risk calculation, and trap detection.
- **Architecture:** Serverless spatial architecture using static vector tiles (PMTiles), build-time Turf.js risk engine, and client-side MapLibre GL visualization.
- **Cross-Repo Role:** Provides standardized parking safety intelligence to `pelipaiva` via `ParkingRiskContract`.

---

## §2 Stack & Invariants

| Use | Never |
|---|---|
| Strict TypeScript (no `any` types) | Untyped spatial GeoJSON objects, ad-hoc `any` casting |
| Biome (`@biomejs/biome`) for strict lint & formatting | Unchecked formatting drift, disabled lints |
| Deterministic 1–10 Risk Score calculation | Dynamic or fabricated risk ratings |
| Turf.js for coordinate & polygon math | Ad-hoc unprojected spherical math approximations |
| Canonical `ParkingRiskContract` interface | Altering or removing contract fields without a major version bump |
| Zero-Secret Commitment | Hardcoded API keys or database credentials in client bundle |

---

## §3 Testing & Quality Gates
- **Pre-visitation Gate:** Run `npm run visit` before any commit.
- **Contract Verification:** Local exports must satisfy `ParkingRiskContract`.
- **Definition of Done:**
  1. `npm run lint` (Biome) reports 0 errors.
  2. Data ingestion and processing pipelines run deterministically.
  3. Web frontend builds without TypeScript or bundling warnings.
  4. Cross-repo contract compatibility check passes.

---

## §4 Security & Hardening
- **Zero Secrets:** Never commit credentials or tokens.
- **Spatial Bounds Sanitization:** All incoming coordinates must be defensively validated within Helsinki metropolitan bounds (60.0°N–60.4°N, 24.5°E–25.3°E).
- **Payload Limits:** Strict size bounds on all raw ingestion feeds.

---

## §5 Design & Usability ("Night Captain")
- **Visuals:** MapLibre GL vector styling adhering to "Night Captain" OLED dark theme with high-contrast safety heatmaps (Green = Safe, Amber = Moderate, Neon Red = Fine Trap).
- **Touch Targets:** All map controls and search inputs must have minimum 44px height (`min-h-[44px]`).

---

## §6 Visitation (Separation of Duties)
- The author who wrote a change does NOT perform its final audit.
- An independent **Visitor subagent** receives only: `AGENTS.md`, the git diff, and test results (no conversation history).
- **Verdicts:** `PASS` · `PASS WITH FINDINGS` · `BLOCK`
- **Finding Classes:**
  - `blocking`: Security flaw, spatial calculation error, contract breach, build failure. Must fix before merge.
  - `advisory`: Rule violation without breakage. Fix or log in `DEBT.md`.
- **Fault Attribution:** `house` (fix code) vs `RULE` (amend `AGENTS.md` and log in `ROLL.md`).

---

## §7 Volatile Facts
Do NOT put volatile facts in `AGENTS.md`. Single sources of truth:
- Library versions: `package.json`
- Recent history: `CHANGELOG.md` and git log
- Spatial schemas & risk logic: `docs/` and `ROLL.md`
