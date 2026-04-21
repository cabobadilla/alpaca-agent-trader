import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Trade from './pages/Trade';
import Approvals from './pages/Approvals';

function App() {
  return (
    <div className="min-h-screen bg-[#0D1117]">
      {/* Top nav */}
      <nav className="border-b border-[#30363D] px-6 py-3 flex items-center gap-6">
        <span className="font-mono font-semibold text-white tracking-tight">
          Alpaca Trader
        </span>
        <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded font-mono">
          PAPER
        </span>
        <div className="flex gap-4 ml-4">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-white' : 'text-[#8B949E] hover:text-white'}`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/trade"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-white' : 'text-[#8B949E] hover:text-white'}`
            }
          >
            Trade
          </NavLink>
          <NavLink
            to="/approvals"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-white' : 'text-[#8B949E] hover:text-white'}`
            }
          >
            Approvals
          </NavLink>
        </div>
      </nav>

      {/* Page content */}
      <main className="px-6 py-6 max-w-6xl mx-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/approvals" element={<Approvals />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
