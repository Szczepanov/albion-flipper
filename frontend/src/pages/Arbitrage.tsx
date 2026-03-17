import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchPrices, fetchHistory, type PriceData, type HistoryData } from '../api/albion';
import { estimateActualTradingPrice, ACTUAL_PRICE_LABELS } from '../utils/price';
import { RefreshCcw, Search, RotateCw } from 'lucide-react';

interface ItemEntry {
  id: string;
  name: string;
}

const CITIES = ['Martlock', 'Thetford', 'Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Caerleon'];

export default function Arbitrage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [itemsList, setItemsList] = useState<ItemEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<ItemEntry | null>(null);
  
  const [prices, setPrices] = useState<PriceData[]>([]);
  const [history, setHistory] = useState<HistoryData[]>([]);
  const [loading, setLoading] = useState(false);
  const [updateCooldown, setUpdateCooldown] = useState(0); // seconds remaining
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    // Load local items database
    let isSubscribed = true;
    fetch('/data/items_min.json')
      .then((res) => res.json())
      .then((data: ItemEntry[]) => {
        if (!isSubscribed) return;
        setItemsList(data);
        
        // Load initial state from URL query parameter
        const queryItem = searchParams.get('item');
        if (queryItem) {
          const found = data.find(i => i.id === queryItem);
          if (found) {
            setSelectedItem(found);
            setSearchTerm(found.name);
            triggerSearch(found); // automatically fetch if directly linked
          }
        }
      })
      .catch((err) => console.error('Error loading items:', err));
      
      return () => { isSubscribed = false; };
  }, []);

  const triggerSearch = async (item: ItemEntry) => {
    setLoading(true);
    const [priceData, historyData] = await Promise.all([
      fetchPrices([item.id], CITIES),
      fetchHistory([item.id], CITIES)
    ]);
    // Sort so cheapest sell orders are at the top
    priceData.sort((a, b) => a.sell_price_min - b.sell_price_min);
    setPrices(priceData);
    setHistory(historyData);
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    
    // Update URL
    setSearchParams({ item: selectedItem.id });
    
    await triggerSearch(selectedItem);
  };

  const handleUpdatePrices = async () => {
    if (!selectedItem || updateCooldown > 0 || loading || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const { initDB } = await import('../api/db');
      const db = await initDB();
      await db.delete('prices', selectedItem.id);
      await db.delete('history', selectedItem.id);
      await triggerSearch(selectedItem);
      // Start 2-minute cooldown
      const COOLDOWN = 120;
      setUpdateCooldown(COOLDOWN);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setUpdateCooldown(prev => {
          if (prev <= 1) {
            clearInterval(cooldownRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshing(false);
    }
  };
  const filteredItems = searchTerm.length > 2 
    ? itemsList.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 10)
    : [];

  return (
    <div className="flex-col gap-4">
      <div className="mb-4">
        <h1>City-to-City Arbitrage</h1>
        <p>Find the best margins by comparing sell orders across Royal Cities. Buy low, transport safely, sell high.</p>
      </div>

      <div className="glass-panel mb-8" style={{ position: 'relative', zIndex: 200 }}>
        <form onSubmit={handleSearch} className="flex gap-4 items-center">
          <div className="w-full" style={{ position: 'relative' }}>
            <div className="flex items-center gap-2">
              <Search size={20} color="#94a3b8" />
              <input 
                type="text" 
                placeholder="Search for an item (e.g., Adept's Bag)" 
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  if (selectedItem && e.target.value !== selectedItem.name) {
                    setSelectedItem(null);
                  }
                }}
              />
            </div>
            
            {filteredItems.length > 0 && !selectedItem && (
              <div 
                className="glass-panel" 
                style={{ 
                  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '0.5rem', 
                  maxHeight: '300px', overflowY: 'auto', zIndex: 100, padding: '0.5rem'
                }}
              >
                {filteredItems.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => {
                      setSelectedItem(item);
                      setSearchTerm(item.name);
                    }}
                    style={{ padding: '0.75rem', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <img 
                      src={`https://render.albiononline.com/v1/item/${item.id}.png?size=40`} 
                      alt=""
                      style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                    <div>
                      {item.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.8em' }}>({item.id})</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <button type="submit" disabled={!selectedItem || loading} className="flex items-center gap-2">
            {loading ? <RefreshCcw className="animate-spin" size={20} /> : <Search size={20} />}
            Analyze
          </button>
          
          {selectedItem && (
            <>
              <button 
                type="button" 
                onClick={() => { setSelectedItem(null); setSearchTerm(''); setPrices([]); setHistory([]); setSearchParams({}); }}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleUpdatePrices}
                disabled={updateCooldown > 0 || loading || isRefreshing}
                title={updateCooldown > 0 ? `Available in ${updateCooldown}s` : 'Force-refresh prices from API'}
                style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--border-light)', 
                  color: updateCooldown > 0 ? 'var(--text-muted)' : 'var(--accent-primary)',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  opacity: updateCooldown > 0 ? 0.6 : 1
                }}
              >
                <RotateCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                {updateCooldown > 0 ? `${Math.floor(updateCooldown / 60)}:${String(updateCooldown % 60).padStart(2, '0')}` : 'Update Prices'}
              </button>
            </>
          )}
        </form>
      </div>

      {prices.length > 0 && (
        <div className="flex-col gap-4">
          <h2 className="mb-2">Live Market Data for {selectedItem?.name}</h2>
          
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {CITIES.map(city => {
              // Group prices by city
              const cityPrices = prices.filter(p => p.city === city);
              if (cityPrices.length === 0) return null;

              const cityHistory = history.filter(h => h.location === city);
              const now = new Date().getTime();
              const dayMs = 24 * 60 * 60 * 1000;
              
              let vol24h = 0;
              let vol7d = 0;
              let vol4w = 0;
              let oldVolume = 0;
              let oldPriceSum = 0;
              let recentAvgPrice: number | null = null;
              let lastKnownPrice: number | null = null;
              let avgPrice7d: number | null = null;
              let lastKnownDate: string | null = null;

              if (cityHistory.length > 0) {
                const dailyTotals = new Map<string, { count: number; value: number }>();

                cityHistory.forEach(hData => {
                  if (hData.data && Array.isArray(hData.data)) {
                    hData.data.forEach(point => {
                      const dayKey = point.timestamp.split('T')[0];
                      const existing = dailyTotals.get(dayKey) || { count: 0, value: 0 };
                      existing.count += point.item_count;
                      existing.value += (point.avg_price * point.item_count);
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
                  
                  if (diffdLatest <= 10) { // Only consider recent data for 24h/7d
                    vol24h = mostRecent.item_count;
                    lastKnownPrice = Math.round(mostRecent.avg_price);
                    lastKnownDate = mostRecent.dateStr;

                    const top7 = sortedDays.slice(0, 7);
                    vol7d = Math.round(top7.reduce((sum, pt) => sum + pt.item_count, 0) / top7.length);
                    const top7Vol = top7.reduce((sum, pt) => sum + pt.item_count, 0);
                    avgPrice7d = top7Vol > 0 ? Math.round(top7.reduce((sum, pt) => sum + (pt.avg_price * pt.item_count), 0) / top7Vol) : null;
                    
                    const top3 = sortedDays.slice(0, 3);
                    const top3Vol = top3.reduce((sum, pt) => sum + pt.item_count, 0);
                    recentAvgPrice = top3Vol > 0
                      ? top3.reduce((sum, pt) => sum + (pt.avg_price * pt.item_count), 0) / top3Vol
                      : null;

                    // 4w moving average calculation
                    sortedDays.forEach(pt => {
                      const diffd = (now - pt.timestamp) / dayMs;
                      if (diffd >= 21 && diffd <= 28.5) { // Roughly 3-4 weeks ago
                        oldVolume += pt.item_count;
                        oldPriceSum += (pt.avg_price * pt.item_count);
                      }
                      if (diffd <= 28.5) { // Total volume for the last 4 weeks
                        vol4w += pt.item_count;
                      }
                    });
                  }
                }
              }
              
              const avgPrice4w = oldVolume > 0 ? Math.round(oldPriceSum / oldVolume) : null;

              const isReasonable = (price: number) => {
                if (!avgPrice4w) return true;
                return price <= avgPrice4w * 3;
              };

              // Find the best sell order (lowest) and best buy order (highest) regardless of quality
              // For a flipper, they usually buy the cheapest available to fulfill a buy order, or buy cheap to sell high
              // A better view is to show the absolute cheapest sell, and absolute highest buy
              
              const validSells = cityPrices.filter(p => p.sell_price_min > 0 && isReasonable(p.sell_price_min));
              const validBuys = cityPrices.filter(p => p.buy_price_max > 0 && isReasonable(p.buy_price_max));

              const bestSell = validSells.length > 0 ? validSells.reduce((prev, curr) => prev.sell_price_min < curr.sell_price_min ? prev : curr) : null;
              const bestBuy = validBuys.length > 0 ? validBuys.reduce((prev, curr) => prev.buy_price_max > curr.buy_price_max ? prev : curr) : null;

              const estimatedActual = estimateActualTradingPrice(
                bestBuy ? bestBuy.buy_price_max : null,
                bestSell ? bestSell.sell_price_min : null,
                recentAvgPrice
              );

              // Format relative time helper
              const formatTimeAgo = (dateStr: string) => {
                const date = new Date(dateStr);
                const diff = (new Date().getTime() - date.getTime()) / 60000; // in minutes
                if (diff < 60) return `${Math.round(diff)}m ago`;
                if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
                return `${Math.round(diff / 1440)}d ago`;
              };

              return (
                <div key={city} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem' }}>
                  <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{city}</h3>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-muted)' }}>Min Sell</span>
                    <div style={{ textAlign: 'right' }}>
                      <div className="price-high" style={{ fontWeight: 'bold' }}>
                        {bestSell ? `${bestSell.sell_price_min.toLocaleString()}` : 'No Sells'}
                      </div>
                      {bestSell && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Q{bestSell.quality} • {formatTimeAgo(bestSell.sell_price_min_date)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-muted)' }}>Max Buy</span>
                    <div style={{ textAlign: 'right' }}>
                      <div className="price-low" style={{ fontWeight: 'bold' }}>
                        {bestBuy ? `${bestBuy.buy_price_max.toLocaleString()}` : 'No Buys'}
                      </div>
                      {bestBuy && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Q{bestBuy.quality} • {formatTimeAgo(bestBuy.buy_price_max_date)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-light)' }}>
                    <div className="flex justify-between items-center mb-2">
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Last Known Price</span>
                      <div className="flex flex-col items-end">
                        <span style={{ fontWeight: 600, color: 'var(--accent-primary)', fontSize: '0.9rem' }}>
                          {lastKnownPrice ? `${lastKnownPrice.toLocaleString()}` : 'No Data'}
                          {avgPrice7d && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '6px' }}>
                              (7d: {avgPrice7d.toLocaleString()})
                            </span>
                          )}
                        </span>
                        {lastKnownDate && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                            Last Traded: {lastKnownDate}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-between items-center mb-2">
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Avg Price (~4w ago)</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.875rem' }}>
                        {avgPrice4w ? `${avgPrice4w.toLocaleString()}` : 'No Data'}
                      </span>
                    </div>
                  
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Sales Volume</div>
                    <div className="flex justify-between" style={{ fontSize: '0.875rem' }}>
                      <div className="flex-col items-center">
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{vol24h.toLocaleString()}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>24h</span>
                      </div>
                      <div className="flex-col items-center">
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{vol7d.toLocaleString()}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>7d</span>
                      </div>
                      <div className="flex-col items-center">
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{vol4w.toLocaleString()}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>4w</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
