# Albion Flipper

A web application for finding profitable item flipping opportunities in Albion Online.

## Features

- **Item Search**: Find items by name.
- **Market Data**: View buy and sell prices for items in different cities.
- **Arbitrage Calculation**: Calculate potential profit margins for flipping items between cities.
- **Location Data**: View information about different cities in Albion Online.

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