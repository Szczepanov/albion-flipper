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
        <div className="glass-panel">
          <h2 className="mb-4">Live Market Data for {selectedItem?.name}</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>City</th>
                  <th>Quality</th>
                  <th>Min Sell Price</th>
                  <th>Max Buy Order</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p, idx) => (
                  <tr key={`${p.city}-${p.quality}-${idx}`}>
                    <td style={{ fontWeight: 600 }}>{p.city}</td>
                    <td>{p.quality}</td>
                    <td className="price-high">{p.sell_price_min > 0 ? p.sell_price_min.toLocaleString() + ' 🥈' : 'No Data'}</td>
                    <td className="price-low">{p.buy_price_max > 0 ? p.buy_price_max.toLocaleString() + ' 🥈' : 'No Data'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {new Date(p.sell_price_min_date).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
