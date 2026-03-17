
import { useMemo, useState } from 'react';
import { AlertCircle, Loader2, Search, ShieldAlert, Skull } from 'lucide-react';
import { fetchPrices, fetchHistory } from '../api/albion';

interface ItemEntry {
  id: string;
  name: string;
}

interface BlackMarketOpportunity {
  itemId: string;
  itemName: string;
  quality: number;
  sourceCity: string;
  routeType: 'FAST' | 'DANGEROUS';
  buyPrice: number;
  blackMarketBuyPrice: number;
  netSellPrice: number;
  netProfit: number;
  roi: number;
  bmVol24h: number;
  bmVol7d: number;
  recommendedQty: number;
  manifestQty: number;
  totalInvestment: number;
  totalProfit: number;
}

const BLACK_MARKET = 'Black Market';
const QUALITIES = [1, 2, 3, 4, 5];
const QUALITY_LABELS: Record<number, string> = {
  1: 'Normal',
  2: 'Good',
  3: 'Outstanding',
  4: 'Excellent',
  5: 'Masterpiece',
};
const MAJOR_CITIES = ['Martlock', 'Thetford', 'Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Caerleon'];
const ROYAL_CITIES = MAJOR_CITIES.filter(c => c !== 'Caerleon');
const TIERS = ['T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const CATEGORIES = [
  { id: 'WEAPON', label: 'Weapons', searchStr: 'MAIN|2H|OFF' },
  { id: 'ARMOR', label: 'Armor', searchStr: 'HEAD|ARMOR|SHOES' },
  { id: 'BAG', label: 'Bags', searchStr: 'BAG|BACKPACK' },
  { id: 'CAPE', label: 'Capes', searchStr: 'CAPEITEM|^CAPE$' },
  { id: 'MOUNT', label: 'Mounts', searchStr: 'MOUNT' },
  { id: 'MEAL', label: 'Meals', searchStr: 'MEAL' },
  { id: 'POTION', label: 'Potions', searchStr: 'POTION' },
  { id: 'REFINED', label: 'Refined Mats', searchStr: 'PLANKS|METALBAR|LEATHER|CLOTH|STONEBLOCK' },
];
const CATEGORY_IDS = CATEGORIES.map(c => c.id);

const formatCompactSilver = (n: number) => (
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : n.toString()
);

const getDailyVolumeWindow = (histData: { timestamp: string; item_count: number }[]) => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const dailyVolume = new Map<string, number>();
  for (const point of histData) {
    const dayKey = point.timestamp.split('T')[0];
    dailyVolume.set(dayKey, (dailyVolume.get(dayKey) || 0) + point.item_count);
  }

  let v24 = 0;
  let v7 = 0;
  for (const [day, count] of dailyVolume.entries()) {
    const diffDays = (now - new Date(day).getTime()) / dayMs;
    if (diffDays <= 1.5) v24 += count;
    if (diffDays <= 7) v7 += count;
  }
  return { v24, v7 };
};

export default function BlackMarket() {
  const [selectedTiers, setSelectedTiers] = useState<Set<string>>(new Set(['T4', 'T5', 'T6', 'T7', 'T8']));
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set(CATEGORY_IDS));
  const [routeMode, setRouteMode] = useState<'caerleon' | 'royals' | 'both'>('both');
  const [minRoi, setMinRoi] = useState(1);
  const [minBmVolume, setMinBmVolume] = useState(0);
  const [budget, setBudget] = useState(2_000_000);
  const [maxMarketShare, setMaxMarketShare] = useState(20);
  const [marketTaxPct, setMarketTaxPct] = useState(4);
  const [transportCostPerItem, setTransportCostPerItem] = useState(0);

  const [isScanning, setIsScanning] = useState(false);
  const [progressText, setProgressText] = useState('Idle');
  const [errorObj, setErrorObj] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<BlackMarketOpportunity[]>([]);

  const toggleTier = (tier: string) => {
    setSelectedTiers(prev => {
      const n = new Set(prev);
      if (n.has(tier)) n.delete(tier);
      else n.add(tier);
      return n;
    });
  };

  const toggleCategory = (catId: string) => {
    setSelectedCats(prev => {
      const n = new Set(prev);
      if (n.has(catId)) n.delete(catId);
      else n.add(catId);
      return n;
    });
  };

  const sourceCities = useMemo(() => {
    if (routeMode === 'caerleon') return ['Caerleon'];
    if (routeMode === 'royals') return ROYAL_CITIES;
    return [...MAJOR_CITIES];
  }, [routeMode]);

  const runScanner = async () => {
    if (selectedTiers.size === 0 || selectedCats.size === 0) {
      setErrorObj('Select at least one tier and one category.');
      return;
    }

    setErrorObj(null);
    setIsScanning(true);
    setOpportunities([]);

    try {
      setProgressText('Loading item catalog...');
      const itemRes = await fetch('/data/items_min.json');
      const allItems: ItemEntry[] = await itemRes.json();

      const selectedItems = allItems.filter(item => {
        const matchesTier = Array.from(selectedTiers).some(t => item.id.startsWith(t));
        if (!matchesTier) return false;

        const matchesCategory = Array.from(selectedCats).some(catId => {
          const cat = CATEGORIES.find(c => c.id === catId);
          if (!cat) return false;
          return new RegExp(`(${cat.searchStr})`).test(item.id);
        });

        const isTradable = !item.id.includes('ARTEFACT') && !item.id.includes('BP') && !item.id.includes('TOKEN');
        return matchesCategory && isTradable;
      });

      if (selectedItems.length === 0) {
        setErrorObj('No items match your filters.');
        setIsScanning(false);
        return;
      }

      if (selectedItems.length > 600) selectedItems.length = 600;
      const ids = selectedItems.map(i => i.id);

      setProgressText('Fetching market prices + history...');
      const [priceData, histData] = await Promise.all([
        fetchPrices(ids, [...sourceCities, BLACK_MARKET]),
        fetchHistory(ids, [BLACK_MARKET]),
      ]);

      const byItemName = new Map(selectedItems.map(i => [i.id, i.name]));
      const opps: BlackMarketOpportunity[] = [];

      setProgressText('Calculating opportunities...');
      for (const itemId of ids) {
        const itemPrices = priceData.filter(p => p.item_id === itemId);
        if (itemPrices.length === 0) continue;
        const bmHistory = histData.filter(h => h.item_id === itemId && h.location === BLACK_MARKET);

        for (const quality of QUALITIES) {
          const bmQuotes = itemPrices.filter(
            p => p.city === BLACK_MARKET && p.quality === quality && p.buy_price_max > 0
          );
          if (bmQuotes.length === 0) continue;
          const bestBmBuy = Math.max(...bmQuotes.map(p => p.buy_price_max));
          if (bestBmBuy <= 0) continue;

          const qualityHistory = bmHistory.filter(h => h.quality === quality);
          const flatPoints = qualityHistory.flatMap(h => h.data || []);
          const { v24, v7 } = getDailyVolumeWindow(flatPoints);
          if (v24 < minBmVolume) continue;

          const sourceQuotes = itemPrices.filter(
            p => sourceCities.includes(p.city) && p.quality === quality && p.sell_price_min > 0
          );
          if (sourceQuotes.length === 0) continue;

          const cheapestByCity = sourceCities
            .map(city => {
              const cityQuotes = sourceQuotes.filter(p => p.city === city);
              if (cityQuotes.length === 0) return null;
              return {
                city,
                price: Math.min(...cityQuotes.map(p => p.sell_price_min)),
              };
            })
            .filter(Boolean) as { city: string; price: number }[];

          for (const source of cheapestByCity) {
            const tax = Math.ceil(bestBmBuy * (marketTaxPct / 100));
            const netSell = bestBmBuy - tax;
            const netProfit = netSell - source.price - transportCostPerItem;
            const roi = source.price > 0 ? (netProfit / source.price) * 100 : 0;

            if (roi < minRoi || netProfit <= 0) continue;

            const maxQtyByBudget = budget > 0 ? Math.floor(budget / source.price) : 9999;
            const maxQtyByVolume = Math.floor(v24 * (maxMarketShare / 100));
            const recommendedQty = Math.max(1, Math.min(maxQtyByBudget, maxQtyByVolume));

            opps.push({
              itemId,
              itemName: byItemName.get(itemId) || itemId,
              quality,
              sourceCity: source.city,
              routeType: source.city === 'Caerleon' ? 'FAST' : 'DANGEROUS',
              buyPrice: source.price,
              blackMarketBuyPrice: bestBmBuy,
              netSellPrice: netSell,
              netProfit,
              roi,
              bmVol24h: v24,
              bmVol7d: v7,
              recommendedQty,
              manifestQty: 0,
              totalInvestment: 0,
              totalProfit: 0,
            });
          }
        }
      }

      // Budget pass per source route, prioritizing highest ROI.
      opps.sort((a, b) => b.roi - a.roi);
      const bySource: Record<string, BlackMarketOpportunity[]> = {};
      for (const opp of opps) {
        if (!bySource[opp.sourceCity]) bySource[opp.sourceCity] = [];
        bySource[opp.sourceCity].push(opp);
      }

      for (const routeOpps of Object.values(bySource)) {
        let remaining = budget;
        for (const opp of routeOpps) {
          const maxCanBuy = opp.buyPrice > 0 ? Math.floor(remaining / opp.buyPrice) : 0;
          const qty = Math.min(opp.recommendedQty, maxCanBuy);
          opp.manifestQty = qty;
          opp.totalInvestment = qty * opp.buyPrice;
          opp.totalProfit = qty * opp.netProfit;
          remaining -= opp.totalInvestment;
        }
      }

      opps.sort((a, b) => b.totalProfit - a.totalProfit);
      setOpportunities(opps.filter(o => o.manifestQty > 0));
      setProgressText(`Scan complete: ${opps.length} valid opportunities`);
    } catch (err: any) {
      setErrorObj(err.message || 'Scanner failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const groupedBySource = useMemo(() => {
    const grouped: Record<string, BlackMarketOpportunity[]> = {};
    for (const opp of opportunities) {
      if (!grouped[opp.sourceCity]) grouped[opp.sourceCity] = [];
      grouped[opp.sourceCity].push(opp);
    }
    return Object.entries(grouped)
      .map(([sourceCity, items]) => ({
        sourceCity,
        items,
        totalProfit: items.reduce((sum, i) => sum + i.totalProfit, 0),
        totalInvestment: items.reduce((sum, i) => sum + i.totalInvestment, 0),
        routeType: items[0]?.routeType ?? 'DANGEROUS',
      }))
      .sort((a, b) => b.totalProfit - a.totalProfit);
  }, [opportunities]);

  return (
    <div className="flex-col gap-4">
      <div className="mb-4">
        <h1>Black Market Flipping</h1>
        <p>Find profitable routes into Caerleon&apos;s Black Market buy orders, from fast local flips to risky royal transports.</p>
      </div>

      <div className="glass-panel mb-8" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>Route Mode</label>
            <select value={routeMode} onChange={(e) => setRouteMode(e.target.value as 'caerleon' | 'royals' | 'both')} disabled={isScanning}>
              <option value="both">Both Strategies</option>
              <option value="caerleon">Caerleon Only (Fast)</option>
              <option value="royals">Royal Cities Only (High Risk)</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>Min ROI %</label>
            <input type="number" min={1} value={minRoi} onChange={(e) => setMinRoi(Number(e.target.value))} disabled={isScanning} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>Min BM Vol (24h)</label>
            <input type="number" min={0} value={minBmVolume} onChange={(e) => setMinBmVolume(Number(e.target.value))} disabled={isScanning} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>Budget (Silver)</label>
            <input type="number" min={0} step={100000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} disabled={isScanning} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>Max Market Share %</label>
            <input type="number" min={1} max={100} value={maxMarketShare} onChange={(e) => setMaxMarketShare(Number(e.target.value))} disabled={isScanning} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>Market Tax %</label>
            <input type="number" min={0} max={20} value={marketTaxPct} onChange={(e) => setMarketTaxPct(Number(e.target.value))} disabled={isScanning} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>Transport Cost / item</label>
            <input type="number" min={0} value={transportCostPerItem} onChange={(e) => setTransportCostPerItem(Number(e.target.value))} disabled={isScanning} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>Tiers</div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {TIERS.map(tier => (
              <button
                key={tier}
                type="button"
                disabled={isScanning}
                onClick={() => toggleTier(tier)}
                style={{
                  padding: '0.4rem 0.7rem',
                  background: selectedTiers.has(tier) ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'rgba(255,255,255,0.05)',
                }}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>Categories</div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                type="button"
                disabled={isScanning}
                onClick={() => toggleCategory(cat.id)}
                style={{
                  padding: '0.4rem 0.7rem',
                  background: selectedCats.has(cat.id) ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'rgba(255,255,255,0.05)',
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <button type="button" onClick={runScanner} disabled={isScanning} className="flex items-center gap-2" style={{ justifyContent: 'center' }}>
          {isScanning ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
          {isScanning ? progressText : 'Scan Black Market'}
        </button>
      </div>

      {errorObj && (
        <div className="glass-panel mb-4" style={{ borderColor: 'rgba(239, 68, 68, 0.5)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <AlertCircle size={18} color="#f87171" style={{ marginTop: '0.2rem' }} />
          <div>{errorObj}</div>
        </div>
      )}

      {!isScanning && opportunities.length === 0 && !errorObj && (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <p style={{ marginBottom: '0.5rem' }}>Run the scanner to find profitable Black Market flips.</p>
          <p style={{ fontSize: '0.9rem' }}>Use `Caerleon Only` for low-risk quick flips or include royal routes for higher upside with PvP travel risk.</p>
        </div>
      )}

      <div className="flex-col gap-4">
        {groupedBySource.map(group => (
          <div key={group.sourceCity} className="glass-panel">
            <div className="flex justify-between items-center mb-4" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '0.65rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>{group.sourceCity} -&gt; Black Market</h3>
                <p style={{ marginTop: '0.3rem', fontSize: '0.85rem' }}>
                  {group.routeType === 'FAST' ? 'Fast local sell loop (lower spread).' : 'Royal transport route (higher danger, potentially better spread).'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'var(--success)', fontWeight: 700 }}>+{formatCompactSilver(group.totalProfit)}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Invest {formatCompactSilver(group.totalInvestment)}</div>
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ textAlign: 'right' }}>Buy @ {group.sourceCity}</th>
                    <th style={{ textAlign: 'right' }}>BM Buy / Net Sell</th>
                    <th style={{ textAlign: 'right' }}>Net Profit / ROI</th>
                    <th style={{ textAlign: 'center' }}>BM Volume</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Total Profit</th>
                    <th style={{ textAlign: 'center' }}>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map(opp => (
                    <tr key={`${opp.itemId}-${opp.quality}-${opp.sourceCity}`}>
                      <td>
                        <div className="flex items-center gap-2">
                          <img
                            src={`https://render.albiononline.com/v1/item/${opp.itemId}.png?size=50`}
                            alt={opp.itemName}
                            style={{ width: '44px', height: '44px', objectFit: 'contain' }}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                          <div>
                            <div style={{ fontWeight: 600 }}>{opp.itemName}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {opp.itemId}@{opp.quality} • Q{opp.quality} {QUALITY_LABELS[opp.quality] || ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>{opp.buyPrice.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div>{opp.blackMarketBuyPrice.toLocaleString()}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Net: {opp.netSellPrice.toLocaleString()}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ color: 'var(--success)', fontWeight: 700 }}>+{opp.netProfit.toLocaleString()}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{opp.roi.toFixed(1)}%</div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div>{opp.bmVol24h.toLocaleString()} / 24h</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{opp.bmVol7d.toLocaleString()} / 7d</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>{opp.manifestQty.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 700 }}>+{formatCompactSilver(opp.totalProfit)}</td>
                      <td style={{ textAlign: 'center' }}>
                        {opp.routeType === 'FAST' ? (
                          <span title="No cross-royal transport required">
                            <ShieldAlert size={16} color="#22c55e" />
                          </span>
                        ) : (
                          <span title="Route typically crosses full-loot PvP zones">
                            <Skull size={16} color="#f87171" />
                          </span>
                        )}
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
  );
}
