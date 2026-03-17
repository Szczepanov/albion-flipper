import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import Arbitrage from './pages/Arbitrage';
import Scanner from './pages/Scanner';
import StashScanner from './pages/StashScanner';
import BlackMarket from './pages/BlackMarket';
import Crafting from './pages/Crafting';
import { Activity, TrendingUp, Hammer, Search, Package } from 'lucide-react';
import './index.css';

function App() {
  return (
    <Router>
      <div className="app-container">
        <nav className="navbar">
          <div className="flex items-center gap-2">
            <TrendingUp size={28} color="#3b82f6" />
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>Albion Flipper</span>
          </div>
          <div className="nav-links">
            <NavLink to="/" className={({isActive}: {isActive: boolean}) => `nav-link ${isActive ? 'active' : ''}`} end>
              <Activity size={18} />
              Arbitrage
            </NavLink>
            <NavLink to="/scanner" className={({isActive}: {isActive: boolean}) => `nav-link ${isActive ? 'active' : ''}`}>
              <Search size={18} />
              Auto-Scanner
            </NavLink>
            <NavLink to="/stash" className={({isActive}: {isActive: boolean}) => `nav-link ${isActive ? 'active' : ''}`}>
              <Package size={18} />
              Stash Scanner
            </NavLink>
            <NavLink to="/black-market" className={({isActive}: {isActive: boolean}) => `nav-link ${isActive ? 'active' : ''}`}>
              <TrendingUp size={18} />
              Black Market
            </NavLink>
            <NavLink to="/crafting" className={({isActive}: {isActive: boolean}) => `nav-link ${isActive ? 'active' : ''}`}>
              <Hammer size={18} />
              Crafting
            </NavLink>
          </div>
        </nav>
        
        <main className="page-content">
          <Routes>
            <Route path="/" element={<Arbitrage />} />
            <Route path="/scanner" element={<Scanner />} />
            <Route path="/stash" element={<StashScanner />} />
            <Route path="/black-market" element={<BlackMarket />} />
            <Route path="/crafting" element={<Crafting />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
