import { useState, useEffect } from 'react';
import { fetchPrices, type PriceData } from '../api/albion';
import { RefreshCcw, Search } from 'lucide-react';

interface ItemEntry {
  id: string;
  name: string;
}

const CITIES = ['Martlock', 'Thetford', 'Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Caerleon'];

export default function Arbitrage() {
  const [itemsList, setItemsList] = useState<ItemEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<ItemEntry | null>(null);
  
  const [prices, setPrices] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load local items database
    fetch('/data/items_min.json')
      .then((res) => res.json())
      .then((data) => setItemsList(data))
      .catch((err) => console.error('Error loading items:', err));
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    
    setLoading(true);
    const data = await fetchPrices([selectedItem.id], CITIES);
    // Sort so cheapest sell orders are at the top
    data.sort((a, b) => a.sell_price_min - b.sell_price_min);
    setPrices(data);
    setLoading(false);
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

      <div className="glass-panel mb-8">
        <form onSubmit={handleSearch} className="flex gap-4 items-center">
          <div className="w-full" style={{ position: 'relative' }}>
            <div className="flex items-center gap-2">
              <Search size={20} color="#94a3b8" />
              <input 
                type="text" 
                placeholder="Search for an item (e.g., Adept's Bag)" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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
            <button 
              type="button" 
              onClick={() => { setSelectedItem(null); setSearchTerm(''); setPrices([]); }}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            >
              Clear
            </button>
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

              // Find the best sell order (lowest) and best buy order (highest) regardless of quality
              // For a flipper, they usually buy the cheapest available to fulfill a buy order, or buy cheap to sell high
              // A better view is to show the absolute cheapest sell, and absolute highest buy
              
              const validSells = cityPrices.filter(p => p.sell_price_min > 0);
              const validBuys = cityPrices.filter(p => p.buy_price_max > 0);

              const bestSell = validSells.length > 0 ? validSells.reduce((prev, curr) => prev.sell_price_min < curr.sell_price_min ? prev : curr) : null;
              const bestBuy = validBuys.length > 0 ? validBuys.reduce((prev, curr) => prev.buy_price_max > curr.buy_price_max ? prev : curr) : null;

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
                        {bestSell ? `${bestSell.sell_price_min.toLocaleString()} 🥈` : 'No Sells'}
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
                        {bestBuy ? `${bestBuy.buy_price_max.toLocaleString()} 🥈` : 'No Buys'}
                      </div>
                      {bestBuy && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Q{bestBuy.quality} • {formatTimeAgo(bestBuy.buy_price_max_date)}
                        </div>
                      )}
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
