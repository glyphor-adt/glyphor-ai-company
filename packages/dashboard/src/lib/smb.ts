import { useCallback, useEffect, useState } from 'react';
import { apiCall } from './firebase';

export type SmbAgent = {
  role: string;
  display_name: string;
  title: string | null;
  department: string | null;
  avatar_url: string | null;
  summary: string;
  status: string;
  last_run_at: string | null;
};

export type SmbDormantDepartment = {
  department: string;
  count: number;
  sample_roles: string[];
};

export type SmbActivityItem = {
  agent_role: string;
  summary: string;
  created_at: string;
};

export type SmbApproval = {
  id: string;
  title: string;
  summary: string;
  requested_by: string;
  assigned_to: string[];
  created_at: string;
};

export type SmbMetric = {
  label: string;
  value: number;
  detail: string;
};

export type SmbWorkItem = {
  id: string;
  assigned_to: string;
  task_description: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  preview: string;
  full_output: string;
  needs_input: string;
};

export type SmbDirective = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  progress_label: string;
  output_preview: string;
  output_full: string;
  needs_input: string;
  assignments: SmbWorkItem[];
};

export type SmbSummary = {
  organization: {
    id: string;
    name: string;
    website: string | null;
    dashboard_mode: 'smb' | 'internal';
    created_at: string;
  } | null;
  greeting_name: string;
  tasks_completed_this_week: number;
  active_agents: SmbAgent[];
  dormant_departments: SmbDormantDepartment[];
  recent_activity: SmbActivityItem[];
  pending_approvals: SmbApproval[];
  metrics: SmbMetric[];
  work_delivered_this_week: Array<{
    id: string;
    title: string;
    by: string;
    delivered_at: string | null;
    preview: string;
  }>;
  weekly_work: Array<{
    week_label: string;
    completed_count: number;
  }>;
  directives: SmbDirective[];
};

export type SmbSettingsData = {
  user: {
    email: string;
    name: string;
    role: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    website: string | null;
    industry: string | null;
    dashboard_mode: 'smb' | 'internal';
    created_at: string;
  } | null;
  team: {
    active_departments: string[];
    available_departments: string[];
    roster: Array<{
      role: string;
      display_name: string;
      title: string | null;
      department: string | null;
      avatar_url: string | null;
      personality_summary: string;
      working_style: string;
      working_voice: string;
    }>;
    authorized_users: Array<{
      email: string;
      name: string;
      role: string;
    }>;
  };
  work: {
    communication_style: string;
    approval_preference: string;
    focus_areas: string[];
  };
  integrations: {
    slack: boolean;
    teams: boolean;
    google_workspace: boolean;
    hubspot: boolean;
  };
  brand_context: {
    website: string;
    brand_voice: string;
    target_audience: string;
    differentiators: string;
    notes: string;
  };
};

const EMPTY_SUMMARY: SmbSummary = {
  organization: null,
  greeting_name: 'there',
  tasks_completed_this_week: 0,
  active_agents: [],
  dormant_departments: [],
  recent_activity: [],
  pending_approvals: [],
  metrics: [],
  work_delivered_this_week: [],
  weekly_work: [],
  directives: [],
};

export function useSmbSummary() {
  const [data, setData] = useState<SmbSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const summary = await apiCall<SmbSummary>('/api/smb/summary');
      setData(summary ?? EMPTY_SUMMARY);
    } catch {
      setData(EMPTY_SUMMARY);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

export function useSmbSettings() {
  const [data, setData] = useState<SmbSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await apiCall<SmbSettingsData>('/api/smb/settings');
      setData(settings);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const updated = await apiCall<SmbSettingsData>('/api/smb/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setData(updated);
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);

  return { data, loading, saving, refresh, update };
}

export async function submitSmbDirective(text: string, createdBy: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const title = trimmed.length > 72 ? `${trimmed.slice(0, 69).trim()}...` : trimmed;
  await apiCall('/api/founder-directives', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description: trimmed,
      priority: 'high',
      category: 'general',
      target_agents: [],
      created_by: createdBy,
    }),
  });
}

export async function respondToApproval(decisionId: string, action: 'approve' | 'redirect' | 'decline', userEmail: string) {
  const status = action === 'approve' ? 'approved' : 'rejected';
  const resolution_note = action === 'redirect'
    ? 'Redirected for more work.'
    : action === 'decline'
      ? 'Declined.'
      : 'Approved.';

  await apiCall(`/api/decisions/${decisionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      resolved_by: userEmail,
      resolved_at: new Date().toISOString(),
      resolution_note,
    }),
  });
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) return 'Just now';
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

export function accountIsOlderThanThirtyDays(createdAt: string | null | undefined) {
  if (!createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() >= 30 * 86_400_000;
}
