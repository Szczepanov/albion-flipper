import { useState, useMemo } from 'react';
import { Search, MapPin, Loader2, Package, AlertCircle, TrendingUp, X } from 'lucide-react';
import { fetchPrices, fetchHistory } from '../api/albion';

// Royal Cities only — no Caerleon (Red Zone) for safe trading
const CITIES = ['Martlock', 'Thetford', 'Fort Sterling', 'Lymhurst', 'Bridgewatch'];

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

interface StashOpportunity {
  itemId: string;
  name: string;
  city: string;
  localSellPrice: number;
  avgOtherCitiesSellPrice: number;
  premiumPct: number;
  localVol24h: number;
  localVol7d: number;
  avgPrice4w: number | null;
  priceSpikePct: number | null;
}

export default function StashScanner() {
  const [baseCity, setBaseCity] = useState('Lymhurst');
  const [selectedTiers, setSelectedTiers] = useState<Set<string>>(new Set(TIERS));
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set(CATEGORIES.map(c => c.id)));
  const [minPremium, setMinPremium] = useState(20);
  const [minVolume, setMinVolume] = useState(10);
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [opportunities, setOpportunities] = useState<StashOpportunity[]>([]);
  const [errorObj, setErrorObj] = useState<string | null>(null);
  const [excludedItems, setExcludedItems] = useState<Set<string>>(new Set());

  // Sorting
  const [sortField, setSortField] = useState<keyof StashOpportunity>('premiumPct');
  const [sortDesc, setSortDesc] = useState(true);

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
      if (!itemRes.ok) throw new Error('Failed to load item database.');
      const allItems: ItemEntry[] = await itemRes.json();

      // 2. Filter items according to user selections
      const targetIds = allItems.filter(item => {
        const matchesTier = Array.from(selectedTiers).some(t => item.id.startsWith(t));
        if (!matchesTier) return false;

        const matchesCat = Array.from(selectedCats).some(catId => {
          const cat = CATEGORIES.find(c => c.id === catId);
          if (!cat) return false;
          if (cat.searchStr) {
            const regex = new RegExp(`(${cat.searchStr})`);
            return regex.test(item.id);
          }
          return item.id.includes(catId);
        });
        
        const isStandard = !item.id.includes('ARTEFACT') && !item.id.includes('ROYAL') && !item.id.includes('BP');

        return matchesCat && isStandard;
      });

      if (targetIds.length === 0) {
        setErrorObj('No items found matching the selected filters.');
        setIsScanning(false);
        return;
      }
      
      // Cap to 500 items per scan
      if (targetIds.length > 500) {
        targetIds.length = 500;
      }

      setScanProgress({ current: 0, total: targetIds.length });
      const justIds = targetIds.map(i => i.id);

      // 3. Batched fetch via idb caching layer
      setScanProgress({ current: Math.floor(targetIds.length / 2), total: targetIds.length }); // half way
      
      const [priceData, histData] = await Promise.all([
        fetchPrices(justIds, CITIES), // explicit fetch just for Royal Cities
        fetchHistory(justIds) // Fetch for all cities to compute global anchor price
      ]);

      setScanProgress({ current: targetIds.length, total: targetIds.length });

      // 4. Calculate Stash Opportunities
      const newOpps: StashOpportunity[] = [];
      const now = Date.now();
      const dayMs = 1000 * 60 * 60 * 24;

      for (const item of targetIds) {
        const itemPrices = priceData.filter(p => p.item_id === item.id);
        const itemHistGlobal = histData.filter(h => h.item_id === item.id);
        const itemHistLocal = itemHistGlobal.filter(h => h.location === baseCity);

        if (itemPrices.length === 0) continue;

        // Establish a global anchor price from 3-4 week old history to prevent troll listings
        let anchorVol = 0;
        let anchorSum = 0;
        itemHistGlobal.forEach(h => {
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

        // Find local sell price
        const localPrices = itemPrices.filter(p => p.city === baseCity && p.sell_price_min > 0 && isReasonable(p.sell_price_min));
        if (localPrices.length === 0) continue;
        const localSellPrice = Math.min(...localPrices.map(p => p.sell_price_min));

        // Average of other cities minimum sell orders
        let otherCitiesSells: number[] = [];
        for (const city of CITIES) {
          if (city === baseCity) continue;
          const cityPrices = itemPrices.filter(p => p.city === city && p.sell_price_min > 0 && isReasonable(p.sell_price_min));
          if (cityPrices.length > 0) {
            otherCitiesSells.push(Math.min(...cityPrices.map(p => p.sell_price_min)));
          }
        }

        if (otherCitiesSells.length === 0) continue;
        const avgOtherCitiesSellPrice = otherCitiesSells.reduce((a, b) => a + b, 0) / otherCitiesSells.length;

        // Calculate Premium
        const premiumPct = ((localSellPrice - avgOtherCitiesSellPrice) / avgOtherCitiesSellPrice) * 100;

        if (premiumPct >= minPremium) {
          // Check local volume
          let v24 = 0;
          let v7d = 0;
          let ov = 0;
          let ops = 0;
          
          if (itemHistLocal.length > 0) {
            const dailyTotals = new Map<string, { count: number; value: number }>();
            itemHistLocal.forEach(h => {
              if (h.data) {
                h.data.forEach(pt => {
                  const dayKey = pt.timestamp.split('T')[0];
                  const existing = dailyTotals.get(dayKey) || { count: 0, value: 0 };
                  existing.count += pt.item_count;
                  existing.value += (pt.avg_price * pt.item_count);
                  dailyTotals.set(dayKey, existing);
                });
              }
            });

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

              if (diffdLatest <= 5) { // Ensure recently active market
                v24 = mostRecent.item_count;
                
                const top7 = sortedDays.slice(0, 7);
                v7d = Math.round(top7.reduce((sum, pt) => sum + pt.item_count, 0) / top7.length);

                // 4w avg
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
            const avg4w = ov > 0 ? Math.round(ops / ov) : null;
            const spikePct = avg4w && avg4w > 0 ? Math.round(((localSellPrice - avg4w) / avg4w) * 100) : null;
            
            newOpps.push({
              itemId: item.id,
              name: item.name,
              city: baseCity,
              localSellPrice,
              avgOtherCitiesSellPrice,
              premiumPct,
              localVol24h: v24,
              localVol7d: v7d,
              avgPrice4w: avg4w,
              priceSpikePct: spikePct
            });
          }
        }
      }

      setOpportunities(newOpps);

    } catch (err: any) {
      setErrorObj(err.message || 'An error occurred while scanning.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleSort = (field: keyof StashOpportunity) => {
    if (sortField === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  const visibleOpps = useMemo(() => {
    const arr = opportunities.filter(o => !excludedItems.has(o.itemId));
    return arr.sort((a, b) => {
      // @ts-ignore
      let valA = a[sortField];
      // @ts-ignore
      let valB = b[sortField];
      
      // Null handling
      if (valA === null) valA = 0;
      if (valB === null) valB = 0;

      if (valA < valB) return sortDesc ? 1 : -1;
      if (valA > valB) return sortDesc ? -1 : 1;
      return 0;
    });
  }, [opportunities, excludedItems, sortField, sortDesc]);


  return (
    <div className="fade-in max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white flex items-center gap-3">
            <Package className="text-purple-500" size={32} />
            Stash Scanner
          </h1>
          <p className="text-gray-400 mt-2">Find items in your local stash that are currently selling for a premium compared to other cities.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Configuration Panel */}
        <div className="lg:col-span-1 glass-panel p-5">
          <h2 className="text-lg font-bold text-white mb-4 border-b border-gray-800 pb-2">Scan Settings</h2>
          
          <label className="block text-sm font-medium text-gray-400 mb-2">My City (Stash Location)</label>
          <div className="relative mb-6">
            <select
              className="search-input text-sm appearance-none cursor-pointer"
              value={baseCity}
              onChange={(e) => setBaseCity(e.target.value)}
              disabled={isScanning}
            >
              <option disabled hidden>Select Stash City</option>
              {CITIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <MapPin size={16} className="absolute right-4 top-3 text-gray-500 pointer-events-none" />
          </div>

          <label className="block text-sm font-medium text-gray-400 mb-2">Target Tiers</label>
          <div className="flex flex-wrap gap-2 mb-6">
            {TIERS.map(t => (
              <button
                key={t}
                onClick={() => toggleTier(t)}
                disabled={isScanning}
                className="transition-all"
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  backgroundColor: selectedTiers.has(t) ? 'var(--accent-secondary)' : 'rgba(255,255,255,0.05)',
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
                className="transition-all"
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  backgroundColor: selectedCats.has(c.id) ? 'var(--accent-secondary)' : 'rgba(255,255,255,0.05)',
                  color: selectedCats.has(c.id) ? '#fff' : 'var(--text-muted)'
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          <label className="block text-sm font-medium text-gray-400 mb-2">Min. Premium (%) & Local Vol (24h)</label>
          <div className="flex gap-4 mb-8">
            <div className="relative flex-1">
              <input
                type="number"
                className="search-input text-sm"
                value={minPremium}
                onChange={e => setMinPremium(Number(e.target.value))}
                min={1}
                disabled={isScanning}
                title="Minimum percentage local price must be above global average"
              />
              <TrendingUp size={14} className="absolute right-3 top-3 text-gray-500" />
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

          <button  
            className="action-button w-full flex justify-center py-3" 
            onClick={runScanner} 
            disabled={isScanning}
            style={{ background: 'linear-gradient(135deg, var(--accent-secondary), #8b5cf6)' }}
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
        
        {/* Results Area */}
        <div className="lg:col-span-3">
          
          {/* Exclusion chip bar */}
          {excludedItems.size > 0 && (
            <div className="glass-panel p-3 mb-4 flex flex-wrap items-center gap-2">
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

          {errorObj && (
            <div className="glass-panel border-red-500/30 bg-red-500/10 p-4 mb-6 flex items-start gap-3 fade-in">
              <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
              <div className="text-red-200">{errorObj}</div>
            </div>
          )}

          {!isScanning && opportunities.length === 0 && !errorObj && (
            <div className="glass-panel flex flex-col items-center justify-center py-16 text-center text-gray-400 h-full min-h-[400px]">
              <Package size={48} className="mb-4 text-gray-600 opacity-50" />
              <p className="text-lg mb-2">Scan Your Stash</p>
              <p className="text-sm max-w-md">Find items gathering dust in your bank that are currently selling for more in your city than anywhere else.</p>
            </div>
          )}

          {visibleOpps.length > 0 && (
            <div className="glass-panel fade-in overflow-hidden">
               <div className="bg-gradient-to-r from-[rgba(255,255,255,0.05)] to-transparent p-4 border-b border-gray-800 flex justify-between items-center">
                 <h3 className="font-bold text-lg text-white">Local Premium Items in {baseCity}</h3>
                 <span className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/20 px-2 py-1 rounded-full">
                   {visibleOpps.length} Results Found
                 </span>
               </div>
               
               <div className="overflow-x-auto">
                 <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className="border-b border-gray-800 text-sm text-gray-400 tracking-wider">
                       <th className="p-4 font-medium cursor-pointer" onClick={() => handleSort('name')}>
                         Item {sortField === 'name' && (sortDesc ? '↓' : '↑')}
                       </th>
                       <th className="p-4 font-medium text-right cursor-pointer" onClick={() => handleSort('localSellPrice')}>
                         Local Sell min {sortField === 'localSellPrice' && (sortDesc ? '↓' : '↑')}
                       </th>
                       <th className="p-4 font-medium text-right cursor-pointer" onClick={() => handleSort('avgOtherCitiesSellPrice')}>
                         Global Avg {sortField === 'avgOtherCitiesSellPrice' && (sortDesc ? '↓' : '↑')}
                       </th>
                       <th className="p-4 font-medium text-right cursor-pointer" onClick={() => handleSort('premiumPct')}>
                         Premium % {sortField === 'premiumPct' && (sortDesc ? '↓' : '↑')}
                       </th>
                       <th className="p-4 font-medium text-center cursor-pointer" onClick={() => handleSort('localVol24h')}>
                         Vol (24h) {sortField === 'localVol24h' && (sortDesc ? '↓' : '↑')}
                       </th>
                       <th className="p-4"></th>
                     </tr>
                   </thead>
                   <tbody>
                    {visibleOpps.map((opp, idx) => (
                      <tr key={idx} className="border-b border-gray-800/50 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <a
                              href={`/?item=${opp.itemId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open ${opp.name} in Arbitrage`}
                              className="rounded-md transition-transform hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-blue-400/60"
                            >
                              <img
                                src={`https://render.albiononline.com/v1/item/${opp.itemId}.png`}
                                alt={opp.name}
                                className="w-14 h-14 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] rounded-md bg-black/20 border border-white/10"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            </a>
                            <div className="flex flex-col items-start gap-1">
                              <a
                                href={`/?item=${opp.itemId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-white visited:text-white hover:text-purple-300 transition-colors underline decoration-white/40 hover:decoration-purple-300 underline-offset-2 cursor-pointer"
                              >{opp.name}</a>
                              <div className="text-xs text-gray-500">
                                Avg 4w: <span className="text-gray-300">{opp.avgPrice4w ? opp.avgPrice4w.toLocaleString() : '-'}</span>
                              </div>
                              {opp.priceSpikePct !== null && opp.priceSpikePct >= 20 && (
                                <div className="flex items-center gap-1 text-[10px] font-bold text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(251,146,60,0.15)] mt-1 tracking-wide uppercase">
                                  <TrendingUp size={10} />
                                  Spike +{opp.priceSpikePct}% vs Avg
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="font-bold text-green-400">{opp.localSellPrice.toLocaleString()}</div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="font-medium text-gray-400">{Math.round(opp.avgOtherCitiesSellPrice).toLocaleString()}</div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="inline-block px-2 py-1 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/20">
                            +{opp.premiumPct.toFixed(1)}%
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="font-bold text-white text-base">{opp.localVol24h.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{opp.localVol7d.toLocaleString()} (7d avg)</div>
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
          )}
        </div>
      </div>
    </div>
  );
}
