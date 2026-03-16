# Albion Flipper

A web application for finding profitable item flipping opportunities in Albion Online.

## Features

- **Item Search**: Find items by name with automated Albion Online icons.
- **Market Data**: View the best buy and sell prices for items grouped by city.
- **Arbitrage Calculation**: Calculate potential profit margins for flipping items between cities.
- **Volume & Trends**: View 24h, 7d, and 4w sales volume, alongside 4-week historical average prices to determine market direction.
- **Shareable URLs**: Directly share analyzed item pages via URL parameters (e.g., `/?item=T4_BAG`).
- **Persistent Caching**: Leverages browser IndexedDB to safely cache massive API responses (30m for prices, 1h for history), avoiding rate limits and improving speed.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (or yarn)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd albion-flipper
   ```

2. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

### Running the Application

1. Start the development server:
   ```bash
   cd frontend
   npm run dev
   ```

2. Open your browser and navigate to `http://localhost:5173`.

## Data

The application uses the following data files:

- `items.json`: List of all items in the game.
- `world.json`: List of all locations (cities) in the game.

These files are automatically processed by `process_data.js` into `items_min.json` and `world_min.json` for faster loading.

## License

MIT