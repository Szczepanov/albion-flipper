# Albion Flipper

Albion Flipper is a React + TypeScript web app for the **Albion Online Europe server** that helps identify profitable market opportunities.

## Current Modules

- **Arbitrage (live)**: Analyze city-to-city opportunities for a selected item, including 24h/7d/4w volume context and URL sharing (`/?item=ITEM_ID`).
- **Auto-Scanner (active/beta)**: Batch scans many items with tier/category filters, budget limits, and market-share caps to build route-level manifests.
- **Black Market (WIP)**: Planned Royal City vs Caerleon Black Market comparison view.
- **Crafting (WIP)**: Planned refining/crafting profitability tools.

## Stack

- React, TypeScript, Vite, React Router DOM
- Axios for API calls
- IndexedDB (`idb`) for persistent client-side caching
- Vanilla CSS (glassmorphism UI)

## Setup

### Prerequisites

- Node.js (modern LTS recommended)
- npm

### Install

```bash
cd frontend
npm install
```

### Run Dev Server

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`.

### Build / Lint

```bash
cd frontend
npm run build
npm run lint
```

## Data Pipeline (ETL)

The frontend reads minimized data from:

- `frontend/public/data/items_min.json`
- `frontend/public/data/world_min.json`

To refresh data from Albion dumps:

1. Place raw `items.json` and/or `world.json` in the repository root.
2. Run:
   ```bash
   node process_data.js
   ```
3. The script writes `items_min.json` and `world_min.json` to the repository root. Copy them to `frontend/public/data/`:
   ```powershell
   Copy-Item .\items_min.json .\frontend\public\data\items_min.json -Force
   Copy-Item .\world_min.json .\frontend\public\data\world_min.json -Force
   ```

## API + Caching

- API base: `https://europe.albion-online-data.com/api/v2/stats`
- Cache TTL:
  - Prices: 30 minutes
  - History: 1 hour

## License

MIT
