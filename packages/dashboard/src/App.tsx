import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Workforce from './pages/Workforce';
import AgentProfile from './pages/AgentProfile';
import AgentBuilder from './pages/AgentBuilder';
import Approvals from './pages/Approvals';
import Chat from './pages/Chat';
import Financials from './pages/Financials';
import Operations from './pages/Operations';
import Strategy from './pages/Strategy';
import TeamsConfig from './pages/TeamsConfig';
import SkillDetail from './pages/SkillDetail';
import Directives from './pages/Directives';
import WorkforceBuilder from './pages/WorkforceBuilder';
import Governance from './pages/Governance';
import Knowledge from './pages/Knowledge';
import Capabilities from './pages/Capabilities';
import Comms from './pages/Comms';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="directives" element={<Directives />} />
        <Route path="workforce" element={<Workforce />} />
        <Route path="agents/new" element={<AgentBuilder />} />
        <Route path="builder" element={<WorkforceBuilder />} />
        <Route path="agents/:agentId" element={<AgentProfile />} />
        <Route path="agents/:agentId/settings" element={<AgentProfile />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="financials" element={<Financials />} />
        <Route path="operations" element={<Operations />} />
        <Route path="strategy" element={<Strategy />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="capabilities" element={<Capabilities />} />
        <Route path="skills/:slug" element={<SkillDetail />} />
        <Route path="comms" element={<Comms />} />
        <Route path="chat/:agentId" element={<Chat />} />
        <Route path="teams-config" element={<TeamsConfig />} />
        <Route path="governance" element={<Governance />} />
        {/* Legacy redirects */}
        <Route path="agents" element={<Navigate to="/workforce" replace />} />
        <Route path="chat" element={<Navigate to="/comms" replace />} />
        <Route path="activity" element={<Navigate to="/operations" replace />} />
        <Route path="graph" element={<Navigate to="/knowledge" replace />} />
        <Route path="skills" element={<Navigate to="/capabilities" replace />} />
        <Route path="meetings" element={<Navigate to="/comms" replace />} />
        <Route path="world-model" element={<Navigate to="/capabilities" replace />} />
        <Route path="group-chat" element={<Navigate to="/comms" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
