import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Workforce from './pages/Workforce';
import AgentsList from './pages/AgentsList';
import AgentProfile from './pages/AgentProfile';
import AgentBuilder from './pages/AgentBuilder';
import Approvals from './pages/Approvals';
import Chat from './pages/Chat';
import Financials from './pages/Financials';
import Operations from './pages/Operations';
import Strategy from './pages/Strategy';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="workforce" element={<Workforce />} />
        <Route path="agents" element={<AgentsList />} />
        <Route path="agents/new" element={<AgentBuilder />} />
        <Route path="agents/:agentId" element={<AgentProfile />} />
        {/* Legacy route — redirect to new detail page */}
        <Route path="agents/:agentId/settings" element={<AgentProfile />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="financials" element={<Financials />} />
        <Route path="operations" element={<Operations />} />
        <Route path="strategy" element={<Strategy />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:agentId" element={<Chat />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
