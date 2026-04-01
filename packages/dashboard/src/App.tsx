import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import SmbLayout from './components/SmbLayout';
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
import OraChat from './pages/OraChat';
import Fleet from './pages/Fleet';
import Onboarding from './pages/Onboarding';
import SmbTeam from './pages/SmbTeam';
import SmbWork from './pages/SmbWork';
import SmbApprovals from './pages/SmbApprovals';
import SmbInsights from './pages/SmbInsights';
import SmbSettings from './pages/SmbSettings';
import { useAuth } from './lib/auth';

function DashboardEntryGate() {
  const { effectiveDashboardMode, profileLoading } = useAuth();

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
          <p className="text-sm text-txt-muted">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <Navigate
      to={effectiveDashboardMode === 'smb' ? '/app/smb/dashboard' : '/app/internal/dashboard'}
      replace
    />
  );
}

function OnboardingEntryGate() {
  const { effectiveDashboardMode, profileLoading } = useAuth();

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
          <p className="text-sm text-txt-muted">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  return (
    <Navigate
      to={effectiveDashboardMode === 'smb' ? '/app/smb/onboarding' : '/app/internal/onboarding'}
      replace
    />
  );
}

function LegacyAgentRedirect() {
  const { agentId } = useParams();
  return <Navigate to={`/app/internal/agents/${encodeURIComponent(agentId ?? '')}`} replace />;
}

function LegacyAgentSettingsRedirect() {
  const { agentId } = useParams();
  return <Navigate to={`/app/internal/agents/${encodeURIComponent(agentId ?? '')}/settings`} replace />;
}

function LegacyChatRedirect() {
  const { agentId } = useParams();
  return <Navigate to={`/app/internal/chat/${encodeURIComponent(agentId ?? '')}`} replace />;
}

const LEGACY_INTERNAL_REDIRECTS = [
  { from: 'dashboard', to: '/app/internal/dashboard' },
  { from: 'directives', to: '/app/internal/directives' },
  { from: 'workforce', to: '/app/internal/workforce' },
  { from: 'agents/new', to: '/app/internal/agents/new' },
  { from: 'builder', to: '/app/internal/builder' },
  { from: 'approvals', to: '/app/internal/approvals' },
  { from: 'financials', to: '/app/internal/financials' },
  { from: 'operations', to: '/app/internal/operations' },
  { from: 'strategy', to: '/app/internal/strategy' },
  { from: 'knowledge', to: '/app/internal/knowledge' },
  { from: 'skills', to: '/app/internal/skills' },
  { from: 'comms', to: '/app/internal/comms' },
  { from: 'teams-config', to: '/app/internal/teams-config' },
  { from: 'governance', to: '/app/internal/governance' },
  { from: 'ora', to: '/app/internal/ora' },
  { from: 'change-requests', to: '/app/internal/change-requests' },
  { from: 'fleet', to: '/app/internal/fleet' },
  { from: 'settings', to: '/app/internal/settings' },
  { from: 'agents', to: '/app/internal/workforce' },
  { from: 'chat', to: '/app/internal/comms' },
  { from: 'activity', to: '/app/internal/operations' },
  { from: 'graph', to: '/app/internal/knowledge' },
  { from: 'capabilities', to: '/app/internal/skills' },
  { from: 'meetings', to: '/app/internal/comms' },
  { from: 'world-model', to: '/app/internal/skills' },
  { from: 'group-chat', to: '/app/internal/comms' },
  { from: 'policy', to: '/app/internal/governance' },
  { from: 'models', to: '/app/internal/governance?tab=models' },
];

export default function App() {
  return (
    <Routes>
      <Route index element={<DashboardEntryGate />} />

      <Route path="app/internal" element={<Layout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
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
        <Route path="policy" element={<Navigate to="../governance" replace />} />
        <Route path="ora" element={<OraChat />} />
        <Route path="change-requests" element={<ChangeRequests />} />
        <Route path="models" element={<Navigate to="../governance?tab=models" replace />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="settings" element={<Settings />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>

      <Route path="app/smb" element={<SmbLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<SmbTeam />} />
        <Route path="team" element={<SmbTeam />} />
        <Route path="work" element={<SmbWork />} />
        <Route path="approvals" element={<SmbApprovals />} />
        <Route path="insights" element={<SmbInsights />} />
        <Route path="settings" element={<SmbSettings />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>

      {LEGACY_INTERNAL_REDIRECTS.map((route) => (
        <Route key={route.from} path={route.from} element={<Navigate to={route.to} replace />} />
      ))}
      <Route path="onboarding" element={<OnboardingEntryGate />} />
      <Route path="app/onboarding" element={<OnboardingEntryGate />} />
      <Route path="agents/:agentId" element={<LegacyAgentRedirect />} />
      <Route path="agents/:agentId/settings" element={<LegacyAgentSettingsRedirect />} />
      <Route path="chat/:agentId" element={<LegacyChatRedirect />} />
      <Route path="skills/:slug" element={<Navigate to="/app/internal/skills" replace />} />
      <Route path="*" element={<DashboardEntryGate />} />
    </Routes>
  );
}
