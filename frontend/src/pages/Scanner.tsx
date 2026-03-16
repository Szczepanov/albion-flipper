import { useState } from 'react';
import { Search, MapPin, Loader2, DollarSign, Package, AlertCircle } from 'lucide-react';
import { fetchPrices, fetchHistory } from '../api/albion';

const CITIES = ['Martlock', 'Thetford', 'Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Caerleon'];

// Logistics Matrix: Number of city-to-city "jumps" through safe zones.
// Caerleon is distance '3', but traverses Red Zones (Full Loot PvP risk).
const CITY_DISTANCES: Record<string, Record<string, number>> = {
  'Lymhurst':      { 'Fort Sterling': 1, 'Bridgewatch': 1, 'Thetford': 2, 'Martlock': 2, 'Caerleon': 3 },
  'Fort Sterling': { 'Lymhurst': 1, 'Thetford': 1, 'Martlock': 2, 'Bridgewatch': 2, 'Caerleon': 3 },
  'Thetford':      { 'Fort Sterling': 1, 'Martlock': 1, 'Lymhurst': 2, 'Bridgewatch': 2, 'Caerleon': 3 },
  'Martlock':      { 'Thetford': 1, 'Bridgewatch': 1, 'Fort Sterling': 2, 'Lymhurst': 2, 'Caerleon': 3 },
  'Bridgewatch':   { 'Martlock': 1, 'Lymhurst': 1, 'Thetford': 2, 'Fort Sterling': 2, 'Caerleon': 3 },
  'Caerleon':      { 'Lymhurst': 3, 'Fort Sterling': 3, 'Thetford': 3, 'Martlock': 3, 'Bridgewatch': 3 }
};

// Basic filters for the UI
const TIERS = ['T4', 'T5', 'T6', 'T7', 'T8'];
const CATEGORIES = [
  { id: 'BAG', label: 'Bags' },
  { id: 'CAPE', label: 'Capes' },
  { id: 'MOUNT', label: 'Mounts' },
  { id: 'POTION', label: 'Potions' },
  { id: 'MEAL', label: 'Meals' },
  { id: 'WEAPON', label: 'Weapons / Armor', searchStr: 'MAIN|2H|HEAD|ARMOR|SHOES' } // simple regex matcher
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
  travelCost: number;
  netProfit: number;
  jumps: number;
  isRedZone: boolean;
  roi: number;
  destVol24h: number;
  destVol7d: number;
  avgPrice4w: number | null;
}

export default function Scanner() {
  const [baseCity, setBaseCity] = useState('Lymhurst');
  const [selectedTiers, setSelectedTiers] = useState<Set<string>>(new Set(['T4']));
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set(['BAG']));
  const [minProfit, setMinProfit] = useState(15); // Target ROI %
  const [minVolume, setMinVolume] = useState(10); // Minimum 24h volume
  const [transportCostPerJump, setTransportCostPerJump] = useState(0); // Estimated silver cost to transport 1 item 1 zone jump
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [opportunities, setOpportunities] = useState<TradeOpportunity[]>([]);
  const [errorObj, setErrorObj] = useState<string | null>(null);

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
      
      // Limit to 200 items max for prototype safety
      if (targetIds.length > 250) {
        targetIds.length = 250; 
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

        // Source prices (what we buy at: min sell order in source city)
        const sourcePrices = itemPrices.filter(p => p.city === baseCity && p.sell_price_min > 0);
        if (sourcePrices.length === 0) continue;

        // We assume we buy the cheapest available across all qualities
        const bestSourcePrice = Math.min(...sourcePrices.map(p => p.sell_price_min));

        // Evaluate all OTHER cities
        for (const destCity of CITIES) {
          if (destCity === baseCity) continue;

          // What we can sell at: max buy order OR lowest sell order in dest minus 1 silver
          // Black Market is a special case: we sell directly to buy orders. Real city arbitrage usually implies undercutting sell orders.
          // For City-to-City, the most guaranteed flip is selling to buy orders, or placing a sell order under the current minimum.
          // To be safe and calculate "Guaranteed / Safe" flips, let's use Max Buy Order.
          
          const destPrices = itemPrices.filter(p => p.city === destCity && p.buy_price_max > 0);
          if (destPrices.length === 0) continue;

          const bestDestPrice = Math.max(...destPrices.map(p => p.buy_price_max)); // Liquidate to buy orders
          const grossProfit = bestDestPrice - bestSourcePrice;
          
          // Logistics Cost Math
          const jumps = CITY_DISTANCES[baseCity]?.[destCity] || 0;
          const isRedZone = destCity === 'Caerleon' || baseCity === 'Caerleon';
          
          // If it's a Caerleon route, we might double the travel cost due to risk, or user can factor it mentally.
          // Let's multiply distance cost by 2 for red zone routes as a safety risk premium
          const effectiveJumps = isRedZone ? jumps * 2 : jumps;
          const travelCost = transportCostPerJump * effectiveJumps;
          
          const netProfit = grossProfit - travelCost;
          const roi = (netProfit / (bestSourcePrice + travelCost)) * 100;

          if (roi >= minProfit) {
            // Check volume
            const destHist = itemHist.filter(h => h.location === destCity);
            let v24 = 0;
            let v7d = 0;
            let ov = 0;
            let ops = 0;
            const now = Date.now();
            const dayMs = 1000 * 60 * 60 * 24;

            destHist.forEach(h => {
              if (h.data) {
                h.data.forEach(pt => {
                  const ptTime = new Date(pt.timestamp).getTime();
                  const diffd = (now - ptTime) / dayMs;
                  if (diffd <= 1.5) v24 += pt.item_count;
                  if (diffd <= 7.5) v7d += pt.item_count;
                  
                  if (diffd >= 21 && diffd <= 28.5) {
                    ov += pt.item_count;
                    ops += (pt.avg_price * pt.item_count);
                  }
                });
              }
            });

            if (v24 >= minVolume) {
              newOpps.push({
                itemId: item.id,
                name: item.name,
                sourceCity: baseCity,
                destCity: destCity,
                buyAtPrice: bestSourcePrice,
                sellAtPrice: bestDestPrice,
                grossProfit: grossProfit,
                travelCost: travelCost,
                netProfit: netProfit,
                jumps: jumps,
                isRedZone: isRedZone,
                roi: roi,
                destVol24h: v24,
                destVol7d: v7d,
                avgPrice4w: ov > 0 ? Math.round(ops / ov) : null
              });
            }
          }
        }
      }

      // Sort globally by total theoretical ROI
      newOpps.sort((a, b) => b.roi - a.roi);
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
    if (!groupedOpps[opp.destCity]) groupedOpps[opp.destCity] = [];
    groupedOpps[opp.destCity].push(opp);
  });

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

          <label className="block text-sm font-medium text-gray-400 mb-2">Transport Cost (Silver / Jump)</label>
          <div className="relative mb-8">
            <input
              type="number"
              className="search-input text-sm"
              value={transportCostPerJump}
              onChange={e => setTransportCostPerJump(Number(e.target.value))}
              min={0}
              placeholder="e.g. 50"
              disabled={isScanning}
            />
            <span className="absolute right-3 top-2.5 text-gray-500">🥈</span>
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
        
        {/* Results Panel */}
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
            {Object.keys(groupedOpps).map(destCity => (
              <div key={destCity} className="glass-panel fade-in overflow-hidden">
                <div className="bg-gradient-to-r from-[rgba(255,255,255,0.05)] to-transparent p-4 border-b border-gray-800 flex justify-between items-center flex-wrap gap-4">
                  <div className="flex flex-col">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                      <span className="text-blue-400">{baseCity}</span>
                      <span className="text-gray-500">➔</span>
                      <span className={destCity === 'Caerleon' ? 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'text-purple-400'}>
                        {destCity}
                      </span>
                    </h3>
                    {groupedOpps[destCity].length > 0 && (
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                        <MapPin size={12} />
                        {groupedOpps[destCity][0].jumps} zones away 
                        {groupedOpps[destCity][0].isRedZone && <span className="text-red-400 font-semibold uppercase tracking-wider text-[10px] ml-1 bg-red-500/10 px-1.5 py-0.5 rounded">High Risk PvP</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 bg-black/30 px-3 py-1 rounded-full">
                    {groupedOpps[destCity].length} viable items
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-800 text-sm text-gray-400 uppercase tracking-wider">
                        <th className="p-4 font-medium">Item</th>
                        <th className="p-4 font-medium text-right">Acquisition</th>
                        <th className="p-4 font-medium text-right">Liquidation</th>
                        <th className="p-4 font-medium text-right">Net Profit / ROI</th>
                        <th className="p-4 font-medium text-center">Dest Volume (24h / 7d)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedOpps[destCity].map((opp, idx) => (
                        <tr key={idx} className="border-b border-gray-800/50 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <img 
                                src={`https://render.albiononline.com/v1/item/${opp.itemId}.png`} 
                                alt={opp.name}
                                className="w-10 h-10 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                              <div>
                                <div className="font-semibold text-gray-200">{opp.name}</div>
                                <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                  Avg Price 4w: <span className="text-gray-300">{opp.avgPrice4w ? `${opp.avgPrice4w.toLocaleString()}` : '-'}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-medium text-red-400">-{opp.buyAtPrice.toLocaleString()}</div>
                            <div className="text-xs text-gray-500 mt-0.5">Min Sell Order</div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-medium text-green-400">+{opp.sellAtPrice.toLocaleString()}</div>
                            <div className="text-xs text-gray-500 mt-0.5">Max Buy Order</div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-bold text-white flex flex-col items-end gap-0.5">
                              <span className="flex items-center gap-1 text-green-400">
                                <DollarSign size={14} className="text-green-500" />
                                +{opp.netProfit.toLocaleString()} net
                              </span>
                              {opp.travelCost > 0 && (
                                <span className="text-[10px] text-red-400/80">-{opp.travelCost.toLocaleString()} logistics</span>
                              )}
                            </div>
                            <div className="text-xs font-medium mt-1 px-1.5 py-0.5 rounded inline-block bg-green-500/20 text-green-400">
                              {opp.roi.toFixed(1)}% ROI
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex justify-center gap-3">
                              <div className="text-center">
                                <span className="block font-medium text-gray-200">{opp.destVol24h.toLocaleString()}</span>
                                <span className="text-[10px] text-gray-500 uppercase">24h</span>
                              </div>
                              <div className="text-center">
                                <span className="block font-medium text-gray-200">{opp.destVol7d.toLocaleString()}</span>
                                <span className="text-[10px] text-gray-500 uppercase">7d</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
        
      </div>
    </div>
  );
}
