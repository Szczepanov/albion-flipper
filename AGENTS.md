# Albion Flipper - Agent Instructions

## Project Context
This is a web application designed to help find arbitrage, black market flipping, and crafting opportunities in the game **Albion Online** (specifically on the **Europe** server). 
The project consumes data from the community-driven Albion Online Data Project.

## Tech Stack
- **Frontend**: React, TypeScript, Vite, React Router DOM, Axios, Lucide-React.
- **Styling**: Vanilla CSS (`index.css`) built using modern features (CSS variables). **Do not use Tailwind CSS** unless explicitly instructed by the user.
- **Data Preprocessing**: Node.js script (`process_data.js`).

## Data Pipeline
To prevent loading huge static JSON files directly into the frontend, there is an ETL pipeline step.
1. Download the raw multi-megabyte `items.json` or `world.json` into the root directory.
2. Run `node process_data.js` in the root directory.
3. This script extracts *only the English item names* and outputs compressed `.json` files.
4. It automatically moves the optimized `items_min.json` and `world_min.json` into the `frontend/public/data/` folder so the UI can fetch them quickly.

## API Integration
- **Base URL**: `https://europe.albion-online-data.com/api/v2/stats/`
- **Current Service Wrapper**: Found in `frontend/src/api/albion.ts`.
- The API supports CORS, so no backend proxy is currently needed.

## Aesthetics & Design Rules
When building or modifying UI components, you **MUST** adhere to the following design constraints:
1. **Premium "Glassmorphism" UI**: Use the `.glass-panel` CSS class for cards, containers, dropping shadows, and backdrop filters. 
2. **Dark Mode**: The general aesthetic relies on a deep background (`var(--bg-dark)`) with vibrant accent colors (`var(--accent-primary)`, `var(--accent-secondary)`).
3. **Animations**: Ensure interactive elements (buttons, inputs, dropdowns) have smooth transforms (`transition: transform 0.2s ease`).

## Current Modules
- **Arbitrage**: City-to-city sell order flips.
- **Black Market**: (Under construction) Royal City sell orders vs Caerleon Black Market buy orders.
- **Crafting**: (Under construction) Raw material cost refinement calculator.
