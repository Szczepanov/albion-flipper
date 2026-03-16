import { useState } from 'react';
import { Search, MapPin, Loader2, DollarSign, Package, AlertCircle, TrendingUp, X } from 'lucide-react';
import { fetchPrices, fetchHistory } from '../api/albion';

// Royal Cities only — no Caerleon (Red Zone) for safe trading
const CITIES = ['Martlock', 'Thetford', 'Fort Sterling', 'Lymhurst', 'Bridgewatch'];

// Jump distances between Royal Cities (safe routes only)
const CITY_DISTANCES: Record<string, Record<string, number>> = {
  'Lymhurst':      { 'Fort Sterling': 1, 'Bridgewatch': 1, 'Thetford': 2, 'Martlock': 2 },
  'Fort Sterling': { 'Lymhurst': 1, 'Thetford': 1, 'Martlock': 2, 'Bridgewatch': 2 },
  'Thetford':      { 'Fort Sterling': 1, 'Martlock': 1, 'Lymhurst': 2, 'Bridgewatch': 2 },
  'Martlock':      { 'Thetford': 1, 'Bridgewatch': 1, 'Fort Sterling': 2, 'Lymhurst': 2 },
  'Bridgewatch':   { 'Martlock': 1, 'Lymhurst': 1, 'Thetford': 2, 'Fort Sterling': 2 },
};

// Basic filters for the UI
const TIERS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const CATEGORIES = [
  // Equipment
  { id: 'WEAPON',   label: 'Weapons',       searchStr: 'MAIN|2H|OFF' },
  { id: 'ARMOR',    label: 'Armor',          searchStr: 'HEAD|ARMOR|SHOES' },
  { id: 'BAG',      label: 'Bags',           searchStr: 'BAG|BACKPACK' },
  { id: 'CAPE',     label: 'Capes',          searchStr: 'CAPEITEM|^CAPE$' },
  { id: 'MOUNT',    label: 'Mounts',         searchStr: 'MOUNT' },
  // Consumables
  { id: 'MEAL',     label: 'Meals',          searchStr: 'MEAL' },
  { id: 'POTION',   label: 'Potions',        searchStr: 'POTION' },
  { id: 'FISH',     label: 'Fish',           searchStr: 'FISH' },
  // Raw Materials
  { id: 'RAW',      label: 'Raw Materials',  searchStr: 'WOOD|ORE|HIDE|FIBER|ROCK|FARM' },
  // Refined Materials
  { id: 'REFINED',  label: 'Refined Mats',   searchStr: 'PLANKS|METALBAR|LEATHER|CLOTH|STONEBLOCK' },
];

interface ItemEntry {
  id: string;
  name: string;
}

interface TradeOpportunity {
  itemId: string;
  name: string;
  sourceCity: string;
  destCity: string;
  buyAtPrice: number;
  sellAtPrice: number;
  grossProfit: number;
  roi: number;
  jumps: number;
  destVol24h: number;
  destVol7d: number;
  avgPrice4w: number | null;
  priceSpikePct: number | null;
  recommendedQty: number;   // capped by volume share
  manifestQty: number;      // final budget-allocated qty (greedy across route)
  totalInvestment: number;
  totalProfit: number;
}

export default function Scanner() {
  const [baseCity, setBaseCity] = useState('Lymhurst');
  const [selectedTiers, setSelectedTiers] = useState<Set<string>>(new Set(TIERS));
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set(CATEGORIES.map(c => c.id)));
  const [minProfit, setMinProfit] = useState(15);
  const [minVolume, setMinVolume] = useState(10);
  const [budget, setBudget] = useState(1_000_000);
  const [maxMarketShare, setMaxMarketShare] = useState(20);
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [opportunities, setOpportunities] = useState<TradeOpportunity[]>([]);
  const [errorObj, setErrorObj] = useState<string | null>(null);
  const [excludedItems, setExcludedItems] = useState<Set<string>>(new Set());

  const excludeItem = (itemId: string) => setExcludedItems(prev => new Set([...prev, itemId]));
  const restoreItem = (itemId: string) => setExcludedItems(prev => { const n = new Set(prev); n.delete(itemId); return n; });
  const clearExclusions = () => setExcludedItems(new Set());

  const toggleTier = (t: string) => {
    const next = new Set(selectedTiers);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setSelectedTiers(next);
  };

  const toggleCat = (c: string) => {
    const next = new Set(selectedCats);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setSelectedCats(next);
  };

  const runScanner = async () => {
    if (selectedTiers.size === 0 || selectedCats.size === 0) {
      setErrorObj('Please select at least one Tier and one Category.');
      return;
    }
    setErrorObj(null);
    setIsScanning(true);
    setOpportunities([]);

    try {
      // 1. Fetch local item database
      const itemRes = await fetch('/data/items_min.json');
      const allItems: ItemEntry[] = await itemRes.json();

      // 2. Filter items according to user selections
      const targetIds = allItems.filter(item => {
        // Must match ONE of the selected tiers
        const matchesTier = Array.from(selectedTiers).some(t => item.id.startsWith(t));
        if (!matchesTier) return false;

        // Must match ONE of the selected categories
        const matchesCat = Array.from(selectedCats).some(catId => {
          const cat = CATEGORIES.find(c => c.id === catId);
          if (!cat) return false;
          if (cat.searchStr) {
            const regex = new RegExp(`(${cat.searchStr})`);
            return regex.test(item.id);
          }
          return item.id.includes(catId);
        });
        
        // Exclude artifact/factions/runes etc to keep query sane if necessary
        const isStandard = !item.id.includes('ARTEFACT') && !item.id.includes('ROYAL') && !item.id.includes('BP');

        return matchesCat && isStandard;
      });

      if (targetIds.length === 0) {
        setErrorObj('No items found matching the selected filters.');
        setIsScanning(false);
        return;
      }
      
      // Cap to 500 items per scan for performance — increase once caching is populated
      if (targetIds.length > 500) {
        targetIds.length = 500;
      }

      setScanProgress({ current: 0, total: targetIds.length });

      const justIds = targetIds.map(i => i.id);

      // 3. Batched fetch via idb caching layer
      setScanProgress({ current: Math.floor(targetIds.length / 2), total: targetIds.length }); // half way
      
      const [priceData, histData] = await Promise.all([
        fetchPrices(justIds),
        fetchHistory(justIds)
      ]);

      setScanProgress({ current: targetIds.length, total: targetIds.length });

      // 4. Calculate Arbitrage Opportunities
      const newOpps: TradeOpportunity[] = [];

      for (const item of targetIds) {
        const itemPrices = priceData.filter(p => p.item_id === item.id);
        const itemHist = histData.filter(h => h.item_id === item.id);

        if (itemPrices.length === 0) continue;

        const now = Date.now();
        const dayMs = 1000 * 60 * 60 * 24;

        // Establish a global anchor price from 3-4 week old history to prevent troll listings (e.g. 29 million silver pies)
        let anchorVol = 0;
        let anchorSum = 0;
        itemHist.forEach(h => {
          if (h.data) {
            h.data.forEach(pt => {
              const diffd = (now - new Date(pt.timestamp).getTime()) / dayMs;
              if (diffd >= 21 && diffd <= 28.5) {
                anchorVol += pt.item_count;
                anchorSum += (pt.avg_price * pt.item_count);
              }
            });
          }
        });
        const anchorPrice = anchorVol > 0 ? (anchorSum / anchorVol) : null;
        
        const isReasonable = (price: number) => {
          if (!anchorPrice) return true;
          return price <= anchorPrice * 3; // Block outliers >3x historical avg
        };

        // Source prices (what we buy at: min sell order in source city)
        const sourcePrices = itemPrices.filter(p => p.city === baseCity && p.sell_price_min > 0 && isReasonable(p.sell_price_min));
        if (sourcePrices.length === 0) continue;

        // We assume we buy the cheapest available across all qualities
        const bestSourcePrice = Math.min(...sourcePrices.map(p => p.sell_price_min));

        // Evaluate all OTHER cities
        for (const destCity of CITIES) {
          if (destCity === baseCity) continue;

          // We will use the lowest sell order minus 1 to simulate undercutting, assuming volume is high enough to execute.
          const destPrices = itemPrices.filter(p => p.city === destCity && p.sell_price_min > 0 && isReasonable(p.sell_price_min));
          if (destPrices.length === 0) continue;

          // We assume we buy at source and sell at dest via Sell Orders (undercutting by 1)
          const bestDestPrice = Math.min(...destPrices.map(p => p.sell_price_min)) - 1;

          const buyFee = Math.ceil(bestSourcePrice * 0.025);
          const sellFee = Math.ceil(bestDestPrice * 0.025);
          const salesTax = Math.ceil(bestDestPrice * 0.04); // 4% Premium Tax
          
          const totalCostPerItem = bestSourcePrice + buyFee;
          const totalRevenuePerItem = bestDestPrice - sellFee - salesTax;
          
          const grossProfit = totalRevenuePerItem - totalCostPerItem;
          const jumps = CITY_DISTANCES[baseCity]?.[destCity] || 0;
          // ROI is purely gross margin on invested silver (cost + buy fee)
          const roi = (grossProfit / totalCostPerItem) * 100;

          if (roi >= minProfit) {
            // Check volume
            const destHist = itemHist.filter(h => h.location === destCity);
            let v24 = 0;
            let v7d = 0;
            let ov = 0;
            let ops = 0;
            if (destHist.length > 0) {
              // The API returns an array of history blocks, one per Quality.
              // We must aggregate counts across ALL qualities for the same day.
              const dailyTotals = new Map<string, { count: number; value: number }>();

              destHist.forEach(h => {
                if (h.data) {
                  h.data.forEach(pt => {
                    // Extract just the YYYY-MM-DD part to group by day safely
                    const dayKey = pt.timestamp.split('T')[0];
                    const existing = dailyTotals.get(dayKey) || { count: 0, value: 0 };
                    existing.count += pt.item_count;
                    existing.value += (pt.avg_price * pt.item_count);
                    dailyTotals.set(dayKey, existing);
                  });
                }
              });

              // Convert to array and sort by most recent day first
              const sortedDays = Array.from(dailyTotals.entries())
                .map(([dateStr, totals]) => ({
                  dateStr,
                  timestamp: new Date(dateStr).getTime(),
                  item_count: totals.count,
                  avg_price: totals.count > 0 ? totals.value / totals.count : 0
                }))
                .sort((a, b) => b.timestamp - a.timestamp);

              if (sortedDays.length > 0) {
                const mostRecent = sortedDays[0];
                const diffdLatest = (now - mostRecent.timestamp) / dayMs;
                
                // If the most recent data is older than 10 days, it's a dead market
                if (diffdLatest <= 10) {
                  v24 = mostRecent.item_count;
                  
                  // Avg the top 7 available consecutive records we have for "7d"
                  const top7 = sortedDays.slice(0, 7);
                  v7d = Math.round(top7.reduce((sum, pt) => sum + pt.item_count, 0) / top7.length);
                  
                  // 4w moving average (points ~21-28 days ago)
                  sortedDays.forEach(pt => {
                    const diffd = (now - pt.timestamp) / dayMs;
                    if (diffd >= 21 && diffd <= 28.5) {
                      ov += pt.item_count;
                      ops += (pt.avg_price * pt.item_count);
                    }
                  });
                }
              }
            }

            if (v24 >= minVolume) {
              const maxQtyByBudget = budget > 0 ? Math.floor(budget / bestSourcePrice) : 9999;
              const maxQtyByVolume = Math.floor(v24 * (maxMarketShare / 100));
              const recommendedQty = Math.max(1, Math.min(maxQtyByBudget, maxQtyByVolume));
              
              const avg4w = ov > 0 ? Math.round(ops / ov) : null;
              const spikePct = avg4w && avg4w > 0 ? Math.round(((bestDestPrice - avg4w) / avg4w) * 100) : null;
              
              newOpps.push({
                itemId: item.id,
                name: item.name,
                sourceCity: baseCity,
                destCity: destCity,
                buyAtPrice: bestSourcePrice,
                sellAtPrice: bestDestPrice,
                grossProfit: grossProfit,
                roi: roi,
                jumps: jumps,
                destVol24h: v24,
                destVol7d: v7d,
                avgPrice4w: avg4w,
                priceSpikePct: spikePct,
                recommendedQty: recommendedQty,
                manifestQty: 0, // filled by greedy pass below
                totalInvestment: 0,
                totalProfit: 0,
              });
            }
          }
        }
      }

      // Sort globally by ROI for the manifest greedy pass
      newOpps.sort((a, b) => b.roi - a.roi);

      // Greedy cargo manifest: per route, allocate budget top-down by ROI
      const cityGroups: Record<string, TradeOpportunity[]> = {};
      newOpps.forEach(o => { if (!cityGroups[o.destCity]) cityGroups[o.destCity] = []; cityGroups[o.destCity].push(o); });

      Object.values(cityGroups).forEach(group => {
        // Already sorted by ROI desc; allocate budget greedily
        let remaining = budget;
        group.forEach(opp => {
          // Compute exact cost required to buy one item (including buy order fee)
          const buyFee = Math.ceil(opp.buyAtPrice * 0.025);
          const totalCostPerItem = opp.buyAtPrice + buyFee;
          
          const maxCanBuy = totalCostPerItem > 0 ? Math.floor(remaining / totalCostPerItem) : 0;
          const mQty = Math.min(opp.recommendedQty, maxCanBuy);
          opp.manifestQty = mQty;
          opp.totalInvestment = mQty * totalCostPerItem;
          opp.totalProfit = mQty * opp.grossProfit;
          remaining -= opp.totalInvestment;
        });
      });

      // Re-sort by total profit for final display
      newOpps.sort((a, b) => b.totalProfit - a.totalProfit);
      setOpportunities(newOpps);

    } catch (err: any) {
      setErrorObj(err.message || 'An error occurred while scanning.');
    } finally {
      setIsScanning(false);
    }
  };

  // Group Opportunities by Destination City for rendering
  const groupedOpps: Record<string, TradeOpportunity[]> = {};
  opportunities.forEach(opp => {
    if (opp.manifestQty === 0) return;
    if (excludedItems.has(opp.itemId)) return; // Skip excluded items
    if (!groupedOpps[opp.destCity]) groupedOpps[opp.destCity] = [];
    groupedOpps[opp.destCity].push(opp);
  });

  const routeStats = Object.keys(groupedOpps).map(destCity => {
    const items = groupedOpps[destCity];
    const jumps = items[0]?.jumps || 0;
    const tripMinutes = jumps * 10;
    const totalRouteProfit = items.reduce((s, o) => s + o.totalProfit, 0);
    const silverPerHour = tripMinutes > 0 ? Math.round(totalRouteProfit / (tripMinutes / 60)) : 0;
    return { destCity, items, jumps, tripMinutes, totalRouteProfit, silverPerHour };
  }).sort((a, b) => b.silverPerHour - a.silverPerHour);

  return (
    <div className="fade-in max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white flex items-center gap-3">
            <Search className="text-blue-500" size={32} />
            Auto-Scanner
          </h1>
          <p className="text-gray-400 mt-2">Filter categories and automatically find the most profitable trade routes from your home city.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Configuration Panel */}
        <div className="lg:col-span-1 glass-panel p-5">
          <h2 className="text-lg font-bold text-white mb-4 border-b border-gray-800 pb-2">Scan Settings</h2>
          
          <label className="block text-sm font-medium text-gray-400 mb-2">Base City (Source)</label>
          <div className="relative mb-6">
            <select
              className="search-input text-sm appearance-none cursor-pointer"
              value={baseCity}
              onChange={(e) => setBaseCity(e.target.value)}
              disabled={isScanning}
            >
              <option disabled hidden>Select Source City</option>
              {CITIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <MapPin size={16} className="absolute right-4 top-3 text-gray-500 pointer-events-none" />
          </div>

          <label className="block text-sm font-medium text-gray-400 mb-2">Target Tiers (Select multi)</label>
          <div className="flex flex-wrap gap-2 mb-6">
            {TIERS.map(t => (
              <button
                key={t}
                onClick={() => toggleTier(t)}
                disabled={isScanning}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  transition: '0.2s',
                  backgroundColor: selectedTiers.has(t) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                  color: selectedTiers.has(t) ? '#fff' : 'var(--text-muted)'
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <label className="block text-sm font-medium text-gray-400 mb-2">Target Categories</label>
          <div className="flex flex-wrap gap-2 mb-6">
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => toggleCat(c.id)}
                disabled={isScanning}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  transition: '0.2s',
                  backgroundColor: selectedCats.has(c.id) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                  color: selectedCats.has(c.id) ? '#fff' : 'var(--text-muted)'
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          <label className="block text-sm font-medium text-gray-400 mb-2">Min. ROI (%) & Min Volume (24h)</label>
          <div className="flex gap-4 mb-8">
            <div className="relative flex-1">
              <input
                type="number"
                className="search-input text-sm"
                value={minProfit}
                onChange={e => setMinProfit(Number(e.target.value))}
                min={1}
                disabled={isScanning}
              />
              <span className="absolute right-3 top-2.5 text-gray-500">%</span>
            </div>
            <div className="relative flex-1">
              <input
                type="number"
                className="search-input text-sm"
                value={minVolume}
                onChange={e => setMinVolume(Number(e.target.value))}
                min={0}
                disabled={isScanning}
              />
              <Package size={14} className="absolute right-3 top-3 text-gray-500" />
            </div>
          </div>

          <label className="block text-sm font-medium text-gray-400 mb-2">Capital Budget (Silver)</label>
          <div className="relative mb-4">
            <input
              type="number"
              className="search-input text-sm"
              value={budget}
              onChange={e => setBudget(Number(e.target.value))}
              min={0}
              step={100000}
              placeholder="e.g. 1000000"
              disabled={isScanning}
            />
            <DollarSign size={14} className="absolute right-3 top-3 text-gray-500" />
          </div>

          <label className="block text-sm font-medium text-gray-400 mb-2">Max Market Share ({maxMarketShare}% of 24h vol)</label>
          <div className="relative mb-8">
            <input
              type="range"
              min={1}
              max={50}
              value={maxMarketShare}
              onChange={e => setMaxMarketShare(Number(e.target.value))}
              disabled={isScanning}
              style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>1%</span><span>50%</span>
            </div>
          </div>

          <button  
            className="action-button w-full flex justify-center py-3" 
            onClick={runScanner} 
            disabled={isScanning}
          >
            {isScanning ? (
              <span className="flex items-center gap-2">
                <Loader2 size={18} className="animate-spin" /> 
                Scanning ({scanProgress.current}/{scanProgress.total})
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Search size={18} /> Launch Scanner
              </span>
            )}
          </button>
        </div>
        
        {/* Exclusion chip bar */}
        {excludedItems.size > 0 && (
          <div className="lg:col-span-3 glass-panel p-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider mr-1">Excluded:</span>
            {[...excludedItems].map(id => {
              const name = opportunities.find(o => o.itemId === id)?.name ?? id;
              return (
                <button
                  key={id}
                  onClick={() => restoreItem(id)}
                  className="flex items-center gap-1.5 text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-1 rounded-full hover:bg-red-500/20 transition-colors"
                  title="Click to restore"
                >
                  <X size={10} />{name}
                </button>
              );
            })}
            <button onClick={clearExclusions} className="text-xs text-gray-500 hover:text-gray-300 ml-auto transition-colors">Clear all</button>
          </div>
        )}
        <div className="lg:col-span-3">
          {errorObj && (
            <div className="glass-panel border-red-500/30 bg-red-500/10 p-4 mb-6 flex items-start gap-3 fade-in">
              <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
              <div className="text-red-200">{errorObj}</div>
            </div>
          )}

          {!isScanning && opportunities.length === 0 && !errorObj && (
            <div className="glass-panel flex flex-col items-center justify-center py-16 text-center text-gray-400 h-full min-h-[400px]">
              <Search size={48} className="mb-4 text-gray-600 opacity-50" />
              <p className="text-lg mb-2">Ready to Scan</p>
              <p className="text-sm max-w-md">Select your parameters on the left and hit Launch Scanner to find the most profitable multi-item routes.</p>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {routeStats.map(({ destCity, items, jumps, tripMinutes, totalRouteProfit, silverPerHour }) => {
              const fmtSilver = (n: number) => n >= 1_000_000 ? (n/1_000_000).toFixed(1)+'M' : n >= 1_000 ? (n/1_000).toFixed(0)+'k' : n.toString();
              return (
              <div key={destCity} className="glass-panel fade-in overflow-hidden">
                <div className="bg-gradient-to-r from-[rgba(255,255,255,0.05)] to-transparent p-4 border-b border-gray-800 flex justify-between items-center flex-wrap gap-4">
                  <div className="flex flex-col">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                      <span className="text-blue-400">{baseCity}</span>
                      <span className="text-gray-500">➔</span>
                      <span className="text-purple-400">{destCity}</span>
                    </h3>
                    <div className="text-xs text-gray-400 mt-1 flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1">
                        <MapPin size={11} />{jumps} jump{jumps !== 1 ? 's' : ''} (~{tripMinutes} min)
                      </span>
                      <span className="text-emerald-400 font-semibold">+{fmtSilver(totalRouteProfit)} total</span>
                      <span className="text-yellow-400/80">{fmtSilver(silverPerHour)}/hr</span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-400 bg-black/30 px-3 py-1 rounded-full">
                    {items.length} viable items
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-800 text-sm text-gray-400 uppercase tracking-wider">
                        <th className="p-4 font-medium">Item</th>
                        <th className="p-4 font-medium text-right">Buy @ Source</th>
                        <th className="p-4 font-medium text-right">Sell @ Dest</th>
                        <th className="p-4 font-medium text-right">Gross / ROI</th>
                        <th className="p-4 font-medium text-center">Qty (24h vol)</th>
                        <th className="p-4 font-medium text-right">Total Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((opp, idx) => (
                        <tr key={idx} className="border-b border-gray-800/50 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <img 
                                src={`https://render.albiononline.com/v1/item/${opp.itemId}.png`} 
                                alt={opp.name}
                                className="w-10 h-10 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                              <div className="flex flex-col items-start">
                                <a
                                  href={`/?item=${opp.itemId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold text-gray-200 hover:text-blue-400 transition-colors hover:underline underline-offset-2 cursor-pointer"
                                  title={`Open ${opp.name} in Arbitrage`}
                                >{opp.name}</a>
                                {opp.priceSpikePct !== null && opp.priceSpikePct >= 20 && (
                                  <div className="flex items-center gap-1 text-[10px] font-bold text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(251,146,60,0.15)] mt-1 tracking-wide uppercase">
                                    <TrendingUp size={10} />
                                    Spike +{opp.priceSpikePct}% vs Avg
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                  Avg 4w: <span className="text-gray-300">{opp.avgPrice4w ? opp.avgPrice4w.toLocaleString() : '-'}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-medium text-red-400">-{opp.buyAtPrice.toLocaleString()}</div>
                            <div className="text-xs text-gray-500 mt-0.5 whitespace-nowrap">
                              +{Math.ceil(opp.buyAtPrice * 0.025).toLocaleString()} buy fee
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-medium text-green-400">+{opp.sellAtPrice.toLocaleString()}</div>
                            <div className="text-xs text-gray-500 mt-0.5 whitespace-nowrap">
                              -{Math.ceil(opp.sellAtPrice * 0.025).toLocaleString()} fee,{' '}
                              -{Math.ceil(opp.sellAtPrice * 0.04).toLocaleString()} tax
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-bold text-white flex flex-col items-end gap-0.5">
                              <span className="flex items-center gap-1 text-green-400">
                                +{opp.grossProfit.toLocaleString()}
                              </span>
                            </div>
                            <div className="text-xs font-medium mt-1 px-1.5 py-0.5 rounded inline-block bg-green-500/20 text-green-400">
                              {opp.roi.toFixed(1)}% ROI
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col items-center">
                              <span className="font-bold text-white text-base">×{opp.manifestQty.toLocaleString()}</span>
                              <span className="text-[10px] text-gray-500 mt-0.5">{opp.destVol24h.toLocaleString()} 24h vol</span>
                              <span className="text-[10px] text-gray-600">{opp.destVol7d.toLocaleString()} 7d</span>
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-bold text-emerald-400 text-base">
                              +{opp.totalProfit >= 1_000_000
                                ? (opp.totalProfit / 1_000_000).toFixed(2) + 'M'
                                : opp.totalProfit >= 1_000
                                  ? (opp.totalProfit / 1_000).toFixed(1) + 'k'
                                  : opp.totalProfit.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              invest {opp.totalInvestment >= 1_000_000
                                ? (opp.totalInvestment / 1_000_000).toFixed(2) + 'M'
                                : (opp.totalInvestment / 1_000).toFixed(0) + 'k'}
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => excludeItem(opp.itemId)}
                              className="text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-full p-1 transition-colors"
                              title={`Exclude ${opp.name} from results`}
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}
