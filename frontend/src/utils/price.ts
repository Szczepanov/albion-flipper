export type ActualPriceModel = 'buy-side' | 'mid-spread' | 'history-clamped' | 'sell-side';

export const estimateActualTradingPrice = (
  bestBuy: number | null,
  bestSell: number | null,
  recentAvg: number | null
): { price: number | null; model: ActualPriceModel } => {
  if (!bestBuy && !bestSell) return { price: null, model: 'mid-spread' };
  if (bestBuy && !bestSell) return { price: bestBuy, model: 'buy-side' };
  if (!bestBuy && bestSell) return { price: bestSell, model: 'sell-side' };

  const buy = bestBuy!;
  const sell = bestSell!;
  const spread = sell - buy;
  const spreadPct = spread > 0 ? spread / Math.max(buy, 1) : 0;

  if (recentAvg !== null && recentAvg > 0) {
    const clampedToBook = Math.max(buy, Math.min(sell, recentAvg));

    // If history sits very close to best buy while spread is wide, assume mostly buy-order fills.
    const closeToBuy = Math.abs(clampedToBook - buy) / Math.max(buy, 1) <= 0.05;
    if (spreadPct >= 0.2 && closeToBuy) {
      return { price: buy, model: 'buy-side' };
    }

    // If history is close to best sell and spread is tight, treat as sell-side execution.
    const closeToSell = Math.abs(sell - clampedToBook) / Math.max(sell, 1) <= 0.03;
    if (spreadPct <= 0.08 && closeToSell) {
      return { price: sell, model: 'sell-side' };
    }

    return { price: Math.round(clampedToBook), model: 'history-clamped' };
  }

  // Fallback without recent history: 
  // If the spread is very wide, mid-spread is a dangerous trap because usually items are only moving at the buy-order price.
  if (spreadPct >= 0.2) {
    return { price: buy, model: 'buy-side' };
  }
  return { price: Math.max(buy, sell - 1), model: 'sell-side' };
};

export const ACTUAL_PRICE_LABELS: Record<ActualPriceModel, string> = {
  'buy-side': 'Buy-Side Fills',
  'mid-spread': 'Mid Spread',
  'history-clamped': 'History Anchored',
  'sell-side': 'Sell-Side',
};
