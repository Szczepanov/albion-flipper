# Albion Flipper Architecture

This document describes how data moves through the app and where key logic lives.

## High-Level Flow

1. Static item metadata is served from `frontend/public/data/*.json`.
2. User selects one item (Arbitrage) or item filters (Scanner).
3. Frontend requests market prices/history from Albion Data Project API.
4. Responses are cached in IndexedDB to reduce repeated API calls.
5. Pages compute profitability metrics and render results client-side.

## Components

- UI pages: `frontend/src/pages/*`
- API wrapper: `frontend/src/api/albion.ts`
- IndexedDB cache: `frontend/src/api/db.ts`
- Global styles and visual tokens: `frontend/src/index.css`
- Data ETL script: `process_data.js`

## External API

- Base URL: `https://europe.albion-online-data.com/api/v2/stats`
- Endpoints used:
  - `/prices/{itemIds}.json?locations=...`
  - `/history/{itemIds}.json?time-scale=24&date=...&end_date=...&locations=...`

## Caching Strategy

- Store: IndexedDB (`idb`)
- Object stores:
  - `prices` (key: `item_id`)
  - `history` (key: `item_id`)
- TTL:
  - Prices: 30 minutes
  - History: 1 hour

Note: cache keys are per item ID (not per location set), and filtering by location is done after loading cached/fetched data.

## Module Status (Current)

- Arbitrage: Implemented
- Auto-Scanner: Implemented (active/beta)
- Black Market: Placeholder (WIP)
- Crafting: Placeholder (WIP)

## ETL/Data Preparation

`process_data.js` reads root-level `items.json` and optional `world.json` and writes reduced outputs:

- `items_min.json`: `{ id, name }`
- `world_min.json`: `{ id, name }`

Current behavior writes outputs to repository root. Frontend consumes copies in `frontend/public/data/`.
