# 🅿️ Parkkisakko: Helsinki Parking Trap Detector

## Problem
Parking in Helsinki is a cognitive minefield. Complex zone rules, resident-only restrictions, and "trap" spots with confusing signage lead to avoidable fines. Drivers need more than just "free spots"—they need to know *safe* spots.

## Solution
Parkkisakko is a spatial intelligence dashboard that reduces the financial burden on drivers. It combines real-time parking availability with a probabilistic "Risk Engine" that analyzes historical fine density. It generates a simple 1-10 Risk Score for every spot, helping users avoid high-risk areas.

## Architecture
- **Type**: Serverless Spatial (Static Vector Tiles + Edge Compute)
- **Data Engine**: Node.js ETL Pipeline (Turf.js)
- **Frontend**: React, Vite, MapLibre GL ("Night Captain" Theme)
- **Hosting**: Cloudflare Pages / R2 (Zero-Cost Infrastructure)

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
