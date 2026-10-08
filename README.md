# 🅿️ ParkkiS v2.6.0: Helsinki Parking Safety Map

## Problem
Parking in Helsinki is a cognitive minefield. Complex zone rules, resident-only restrictions, and confusing signage lead to avoidable fines. Drivers need more than just "free spots"—they need to know *safe* spots.

## Solution
ParkkiS maps Helsinki's on-street parking spaces (paid/free, time limits, resident zones), parking-related traffic signs, today's street works and street-area leases, park-and-ride sites, and where parking fines were issued (City of Helsinki open data, 2023). Each space gets a 1-10 rating computed only from the fines recorded within about 20 m. It does not show live free spaces.

Pelipäivä links to a venue with `https://parkkis.pages.dev/venue/<name>?lat=<lat>&lon=<lon>&embed=true`.

Data sources and licences are listed in the app under **Tietolähteet**. Nothing in the app is invented: if a source has no data, the app says so.

## Architecture
- **Type**: Serverless Spatial (Static Vector Tiles + Edge Compute)
- **Data Engine**: Node.js ETL Pipeline (Turf.js)
- **Frontend**: React, Vite, MapLibre GL ("Night Captain" Theme)
- **Hosting**: Cloudflare Pages project `parkkis`, published by the 'Deploy Parkkis' job in traali/pelipaiva `.github/workflows/deploy-neighbors.yml` (run it after merging to `master`).

## Quick Start
1. **Prerequisites**: Node.js 20+.
2. **Clone & Install**:
   ```bash
   git clone <repo>
   npm install
   ```
3. **Run Ingestion**:
   ```bash
   npm run ingest
   ```
4. **Start Dev Server**:
   ```bash
   npm run dev
   ```

## Attribution
Built by Antigravity.
