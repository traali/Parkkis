# Workflow: Chapter (Session Opening Rite)
The opening rite for any agent session in `Parkkis`.

## Steps
1. **Read `AGENTS.md`**: Verify non-negotiables, stack rules, and testing requirements.
2. **Read the tail of `ROLL.md`**: Review the last ~10 entries to understand recent decisions and dead ends.
3. **Read the Task**: Understand the user request or feature spec.
4. **Select Accountable Office & Model Tier**:
   - `cellarer_office`: Ingestion scripts, PMTiles hosting, package configs (`pro`/`flash`)
   - `scriptorium_office`: Spatial GeoJSON parsers, Turf.js bounding filters (`pro`/`flash`)
   - `prior_office`: 1-10 Risk Engine, fine density math, spatial SQL (`pro`)
   - `works_office`: MapLibre GL frontend, "Night Captain" design tokens (`inherit`/`flash`)
   - `sacrist_office`: Ingestion tests, spatial bounds verification (`flash`)
   - `legate_office`: Cross-repo contract conformance with Pelipäivä (`pro`/`inherit`)
   - `visitor_office`: Clean-room adversarial audit (`pro`/`inherit`)
5. **Plan Before Execution**: Formulate a concise plan. For major changes, write an implementation plan.
