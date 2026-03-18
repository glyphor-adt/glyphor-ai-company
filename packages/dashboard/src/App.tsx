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
import Skills from './pages/Skills';
import Comms from './pages/Comms';
import Settings from './pages/Settings';
import ChangeRequests from './pages/ChangeRequests';
import ModelAdmin from './pages/ModelAdmin';
import OraChat from './pages/OraChat';
import Fleet from './pages/Fleet';

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
        <Route path="skills" element={<Skills />} />
        <Route path="skills/:slug" element={<SkillDetail />} />
        <Route path="comms" element={<Comms />} />
        <Route path="chat/:agentId" element={<Chat />} />
        <Route path="teams-config" element={<TeamsConfig />} />
        <Route path="governance" element={<Governance />} />
        <Route path="policy" element={<Navigate to="/governance" replace />} />
        <Route path="ora" element={<OraChat />} />
        <Route path="change-requests" element={<ChangeRequests />} />
        <Route path="models" element={<ModelAdmin />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="settings" element={<Settings />} />
        {/* Legacy redirects */}
        <Route path="agents" element={<Navigate to="/workforce" replace />} />
        <Route path="chat" element={<Navigate to="/comms" replace />} />
        <Route path="activity" element={<Navigate to="/operations" replace />} />
        <Route path="graph" element={<Navigate to="/knowledge" replace />} />
        <Route path="capabilities" element={<Navigate to="/skills" replace />} />
        <Route path="meetings" element={<Navigate to="/comms" replace />} />
        <Route path="world-model" element={<Navigate to="/skills" replace />} />
        <Route path="group-chat" element={<Navigate to="/comms" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
