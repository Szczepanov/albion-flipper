# Albion Flipper Frontend

React + TypeScript + Vite frontend for Albion Flipper.

## Scripts

Run from `frontend/`:

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## App Structure

- `src/App.tsx`: Router + top navigation.
- `src/pages/Arbitrage.tsx`: Single-item city-to-city analysis.
- `src/pages/Scanner.tsx`: Batch scanning workflow with filters and route grouping.
- `src/pages/BlackMarket.tsx`: Placeholder (WIP).
- `src/pages/Crafting.tsx`: Placeholder (WIP).
- `src/api/albion.ts`: API client + batched fetching logic.
- `src/api/db.ts`: IndexedDB cache helpers.
- `src/index.css`: Global styles, tokens, utility classes, glassmorphism panels.

## Data Files

The frontend expects:

- `public/data/items_min.json`
- `public/data/world_min.json`

These are generated from root-level raw dumps via `node process_data.js` (run from repository root), then copied into `frontend/public/data/`.

## Runtime Data Sources

- Base API: `https://europe.albion-online-data.com/api/v2/stats`
- Prices cache TTL: 30 minutes
- History cache TTL: 1 hour

## Routing

- `/`: Arbitrage
- `/scanner`: Auto-Scanner
- `/black-market`: Black Market (WIP)
- `/crafting`: Crafting (WIP)

## UI Conventions

- Use `.glass-panel` for primary cards/containers.
- Preserve dark theme variables from `index.css`.
- Keep interactive transitions smooth (`transform 0.2s ease` baseline).
- Keep styles in vanilla CSS (no Tailwind unless explicitly requested).
