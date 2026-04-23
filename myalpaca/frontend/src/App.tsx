import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Trade from './pages/Trade';
import Approvals from './pages/Approvals';
import Agents from './pages/Agents';
import History from './pages/History';
import Logs from './pages/Logs';

function App() {
  return (
    <div className="min-h-screen bg-[#0D1117]">
      <nav className="border-b border-[#30363D] px-6 py-3 flex items-center gap-6">
        <span className="font-mono font-semibold text-white tracking-tight">
          Alpaca Trader
        </span>
        <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded font-mono">
          PAPER
        </span>
        <div className="flex gap-4 ml-4">
          {[
            { to: '/',        label: 'Dashboard' },
            { to: '/trade',   label: 'Trade'     },
            { to: '/approvals', label: 'Approvals' },
            { to: '/agents',  label: 'Agents'    },
            { to: '/logs',    label: 'Logs'      },
            { to: '/history', label: 'History'   },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `text-sm ${isActive ? 'text-white' : 'text-[#8B949E] hover:text-white'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="px-6 py-6 max-w-6xl mx-auto">
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/trade"     element={<Trade />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/agents"    element={<Agents />} />
          <Route path="/logs"      element={<Logs />} />
          <Route path="/history"   element={<History />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
