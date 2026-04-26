import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  ButtonGhost,
  ButtonOutlineSecondary,
  Card,
  GradientButton,
  SectionHeader,
  Skeleton,
} from '../ui';
import { apiCall } from '../../lib/firebase';

type DepartmentStatus = 'available' | 'configuring' | 'active' | 'paused';

interface DepartmentSummary {
  id: string;
  name: string;
  description: string;
  iconKey: string;
  status: DepartmentStatus;
  agentCount: number;
  estimatedSetupMinutes: number;
  templatesCount: number;
  requiredIntegrationsNotYetConnected: string[];
  agentsThatWillCollaborateWithExisting: string[];
  completionRate: number;
  autonomyAverage: number;
}

interface AgentCatalogTemplate {
  id: string;
  templateName: string;
  defaultRole: string;
  defaultCapacityTier: string;
  defaultDisclosureLevel: string;
  defaultAutonomyMaxLevel: number;
  defaultMcpDomains: string[];
}

interface DepartmentDetail extends DepartmentSummary {
  templates: AgentCatalogTemplate[];
  connectedMcpDomains: string[];
  requiredMcpDomains: string[];
  recommendedMcpDomains: string[];
}

interface ExpansionRecommendation {
  departmentId: string;
  departmentName: string;
  whyRecommended: string;
  estimatedSetupMinutes: number;
  agentsThatWillCollaborateWithExisting: string[];
  requiredIntegrationsNotYetConnected: string[];
}

interface ActivateDepartmentResult {
  activatedAgents: Array<{
    role: string;
    displayName: string;
    title: string;
  }>;
  connectedDepartments: Array<{
    departmentId: string;
    departmentName: string;
    coordinatorAgentName: string | null;
  }>;
  nextRecommendedDepartment: ExpansionRecommendation | null;
}

interface ActivationFormState {
  companyName: string;
  departmentLead: string;
  selectedMcpDomains: string[];
  customAgentNames: Record<string, string>;
}

const STATUS_BADGE: Record<DepartmentStatus, { color: Parameters<typeof Badge>[0]['color']; label: string }> = {
  available: { color: 'sky', label: 'Available' },
  configuring: { color: 'amber', label: 'Configuring' },
  active: { color: 'emerald', label: 'Active' },
  paused: { color: 'gray', label: 'Paused' },
};

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildInitialForm(detail: DepartmentDetail | null): ActivationFormState {
  const required = detail?.requiredMcpDomains ?? [];
  const recommended = detail?.recommendedMcpDomains ?? [];
  const connected = detail?.connectedMcpDomains ?? [];
  return {
    companyName: '',
    departmentLead: '',
    selectedMcpDomains: uniq([...connected, ...required, ...recommended]),
    customAgentNames: {},
  };
}

function statusColor(status: DepartmentStatus): Parameters<typeof Badge>[0]['color'] {
  return STATUS_BADGE[status]?.color ?? 'gray';
}

export default function OnboardingDashboard() {
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [recommendations, setRecommendations] = useState<ExpansionRecommendation[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DepartmentDetail | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [form, setForm] = useState<ActivationFormState>(buildInitialForm(null));
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = useMemo(() => {
    const total = departments.length;
    const active = departments.filter((department) => department.status === 'active').length;
    const percent = total > 0 ? Math.round((active / total) * 100) : 0;
    return { total, active, percent };
  }, [departments]);

  const highlightedRecommendation = recommendations[0] ?? null;

  async function loadDepartments(): Promise<DepartmentSummary[]> {
    const data = await apiCall<DepartmentSummary[]>('/admin/departments');
    setDepartments(data);
    return data;
  }

  async function loadRecommendations(): Promise<ExpansionRecommendation[]> {
    const data = await apiCall<ExpansionRecommendation[]>('/admin/departments/recommendations');
    setRecommendations(data);
    return data;
  }

  async function loadDetail(departmentId: string): Promise<void> {
    setLoadingDetail(true);
    setError(null);
    try {
      const data = await apiCall<DepartmentDetail>(`/admin/departments/${encodeURIComponent(departmentId)}`);
      setDetail(data);
      setForm((current) => ({
        ...buildInitialForm(data),
        companyName: current.companyName,
        departmentLead: current.departmentLead,
        customAgentNames: Object.fromEntries(
          data.templates.map((template) => [template.id, current.customAgentNames[template.id] ?? '']),
        ),
      }));
      setWizardStep(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    Promise.all([loadDepartments(), loadRecommendations()])
      .then(([loadedDepartments, loadedRecommendations]) => {
        if (cancelled) return;
        const preferred = loadedRecommendations[0]?.departmentId
          ?? loadedDepartments.find((department) => department.status !== 'active')?.id
          ?? loadedDepartments[0]?.id
          ?? null;
        setSelectedDepartmentId((current) => current ?? preferred);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedDepartmentId) return;
    void loadDetail(selectedDepartmentId);
  }, [selectedDepartmentId]);

  useEffect(() => {
    if (!departments.length) return;
    if (selectedDepartmentId && departments.some((department) => department.id === selectedDepartmentId)) return;
    setSelectedDepartmentId(departments[0]?.id ?? null);
  }, [departments, selectedDepartmentId]);

  async function refreshData(preferredDepartmentId?: string): Promise<void> {
    const nextDepartments = await loadDepartments();
    const nextRecommendations = await loadRecommendations();
    const nextSelected = preferredDepartmentId
      ?? selectedDepartmentId
      ?? nextRecommendations[0]?.departmentId
      ?? nextDepartments.find((department) => department.status !== 'active')?.id
      ?? nextDepartments[0]?.id
      ?? null;
    setSelectedDepartmentId(nextSelected);
    if (nextSelected) await loadDetail(nextSelected);
  }

  function toggleDomain(domain: string): void {
    setForm((current) => ({
      ...current,
      selectedMcpDomains: current.selectedMcpDomains.includes(domain)
        ? current.selectedMcpDomains.filter((item) => item !== domain)
        : [...current.selectedMcpDomains, domain],
    }));
  }

  function updateCustomName(templateId: string, value: string): void {
    setForm((current) => ({
      ...current,
      customAgentNames: {
        ...current.customAgentNames,
        [templateId]: value,
      },
    }));
  }

  async function handleActivate(): Promise<void> {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        companyName: form.companyName.trim(),
        departmentLead: form.departmentLead.trim(),
        selectedMcpDomains: form.selectedMcpDomains,
        customAgentNames: Object.fromEntries(
          Object.entries(form.customAgentNames)
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value.length > 0),
        ),
      };
      const result = await apiCall<ActivateDepartmentResult>(`/admin/departments/${encodeURIComponent(detail.id)}/activate`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMessage(
        result.nextRecommendedDepartment
          ? `${detail.name} activated. Next recommended department: ${result.nextRecommendedDepartment.departmentName}.`
          : `${detail.name} activated successfully.`,
      );
      await refreshData(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePause(): Promise<void> {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await apiCall(`/admin/departments/${encodeURIComponent(detail.id)}/pause`, {
        method: 'PUT',
        body: JSON.stringify({ updatedBy: 'dashboard' }),
      });
      setMessage(`${detail.name} has been paused.`);
      await refreshData(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canAdvanceToStepTwo = detail !== null;
  const canAdvanceToStepThree = form.companyName.trim().length > 0 && form.departmentLead.trim().length > 0;
  const missingRequiredDomains = detail
    ? detail.requiredMcpDomains.filter((domain) => !form.selectedMcpDomains.includes(domain))
    : [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Department Activation"
        subtitle="Turn on departments one at a time, provision their default agents, and follow the next expansion path suggested by live platform state."
      />

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_40%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.92))] text-white">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200/80">Activation Progress</p>
              <div>
                <h2 className="text-3xl font-semibold">{progress.active} of {progress.total} departments live</h2>
                <p className="mt-2 max-w-2xl text-sm text-prism-secondary">Each department is activated from the catalog, inherits its default operating controls, and connects to existing teams through handoff contracts.</p>
              </div>
            </div>
            <div className="min-w-[220px] rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-prism-secondary">
                <span>Coverage</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-cyan-300 transition-all duration-500" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="mt-3 text-sm text-prism-secondary">Active departments unlock new collaboration routes and reduce manual setup for the next launch wave.</p>
            </div>
          </div>
        </Card>

        <Card className="border-teal-500/20 bg-[linear-gradient(135deg,rgba(10,37,64,0.94),rgba(11,82,91,0.88))] text-white">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/80">Next Recommended Expansion</p>
            {loadingList ? (
              <Skeleton className="h-28" />
            ) : highlightedRecommendation ? (
              <>
                <div>
                  <h3 className="text-2xl font-semibold">{highlightedRecommendation.departmentName}</h3>
                  <p className="mt-2 text-sm text-cyan-50/80">{highlightedRecommendation.whyRecommended}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge color="cyan">{highlightedRecommendation.estimatedSetupMinutes} min setup</Badge>
                  <Badge color="sky">{highlightedRecommendation.agentsThatWillCollaborateWithExisting.length} linked agents</Badge>
                  <Badge color={highlightedRecommendation.requiredIntegrationsNotYetConnected.length > 0 ? 'amber' : 'emerald'}>
                    {highlightedRecommendation.requiredIntegrationsNotYetConnected.length > 0 ? 'Needs integrations' : 'Ready to launch'}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <GradientButton onClick={() => setSelectedDepartmentId(highlightedRecommendation.departmentId)} size="md">
                    Open Activation Wizard
                  </GradientButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-cyan-50/80">No further expansions are recommended yet. Activate a department to unlock the next suggestion.</p>
            )}
          </div>
        </Card>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/10 text-sm text-red-100">
          {error}
        </Card>
      )}

      {message && (
        <Card className="border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-50">
          {message}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <Card>
          <SectionHeader
            title="Department Catalog"
            subtitle="Every department card is generated from the seeded catalog and its current activation state."
          />
          {loadingList ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-40" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {departments.map((department) => {
                const isSelected = department.id === selectedDepartmentId;
                return (
                  <button
                    key={department.id}
                    type="button"
                    onClick={() => setSelectedDepartmentId(department.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${isSelected ? 'border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]' : 'border-border bg-transparent hover:border-cyan-500/30 hover:bg-cyan-500/5'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-prism-tertiary">{department.iconKey || 'department'}</p>
                        <h3 className="mt-2 text-lg font-semibold text-txt-primary">{department.name}</h3>
                      </div>
                      <Badge color={statusColor(department.status)}>{STATUS_BADGE[department.status].label}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-txt-secondary">{department.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge color="sky">{department.templatesCount} templates</Badge>
                      <Badge color="cyan">{department.estimatedSetupMinutes} min</Badge>
                      <Badge color={department.requiredIntegrationsNotYetConnected.length > 0 ? 'amber' : 'emerald'}>
                        {department.requiredIntegrationsNotYetConnected.length > 0 ? `${department.requiredIntegrationsNotYetConnected.length} blockers` : 'Integrations ready'}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            title={detail?.name ?? 'Activation Wizard'}
            subtitle={detail?.description ?? 'Select a department to review its agent catalog and activate it.'}
            action={
              detail ? (
                <div className="flex gap-2">
                  {detail.status === 'active' ? (
                    <ButtonOutlineSecondary onClick={() => void handlePause()} disabled={submitting}>Pause</ButtonOutlineSecondary>
                  ) : null}
                  <GradientButton onClick={() => void refreshData(detail.id)} variant="neutral">Refresh</GradientButton>
                </div>
              ) : null
            }
          />

          {loadingDetail ? (
            <div className="space-y-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-32" />
              <Skeleton className="h-40" />
            </div>
          ) : detail ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <Card className="p-4" outline>
                  <p className="text-xs uppercase tracking-[0.16em] text-prism-tertiary">Agent Templates</p>
                  <p className="mt-2 text-2xl font-semibold text-txt-primary">{detail.templates.length}</p>
                </Card>
                <Card className="p-4" outline>
                  <p className="text-xs uppercase tracking-[0.16em] text-prism-tertiary">Completion Signal</p>
                  <p className="mt-2 text-2xl font-semibold text-txt-primary">{Math.round(detail.completionRate)}%</p>
                </Card>
                <Card className="p-4" outline>
                  <p className="text-xs uppercase tracking-[0.16em] text-prism-tertiary">Autonomy Average</p>
                  <p className="mt-2 text-2xl font-semibold text-txt-primary">{detail.autonomyAverage.toFixed(1)}</p>
                </Card>
              </div>

              <div className="rounded-2xl border border-border bg-prism-bg2/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {['Catalog', 'Operator', 'Names'].map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setWizardStep(index)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${wizardStep === index ? 'bg-cyan-500/20 text-cyan-300' : 'bg-prism-bg2 text-prism-tertiary hover:text-prism-primary'}`}
                    >
                      {index + 1}. {label}
                    </button>
                  ))}
                </div>

                {wizardStep === 0 ? (
                  <div className="mt-4 space-y-4">
                    <p className="text-sm text-txt-secondary">Review the department agent catalog and choose which MCP domains should be connected during activation.</p>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {detail.templates.map((template) => (
                        <div key={template.id} className="rounded-xl border border-border bg-prism-card/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="font-semibold text-txt-primary">{template.templateName}</h4>
                              <p className="text-sm text-txt-secondary">{toTitleCase(template.defaultRole)}</p>
                            </div>
                            <Badge color="sky">L{template.defaultAutonomyMaxLevel}</Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge color="cyan">{template.defaultCapacityTier}</Badge>
                            <Badge color="gray">{template.defaultDisclosureLevel}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-prism-tertiary">MCP Domains</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {uniq([...detail.requiredMcpDomains, ...detail.recommendedMcpDomains, ...detail.connectedMcpDomains]).map((domain) => {
                          const isRequired = detail.requiredMcpDomains.includes(domain);
                          const selected = form.selectedMcpDomains.includes(domain);
                          return (
                            <button
                              key={domain}
                              type="button"
                              onClick={() => (isRequired ? undefined : toggleDomain(domain))}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${selected ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200' : 'border-border bg-transparent text-prism-tertiary'} ${isRequired ? 'cursor-not-allowed opacity-90' : 'hover:border-cyan-500/40 hover:text-prism-primary'}`}
                            >
                              {domain}
                              {isRequired ? ' • required' : detail.connectedMcpDomains.includes(domain) ? ' • connected' : ''}
                            </button>
                          );
                        })}
                      </div>
                      {missingRequiredDomains.length > 0 ? (
                        <p className="mt-3 text-sm text-amber-300">Required domains must remain selected: {missingRequiredDomains.join(', ')}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {wizardStep === 1 ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="space-y-2 text-sm text-txt-secondary">
                      <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-prism-tertiary">Company Name</span>
                      <input
                        value={form.companyName}
                        onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))}
                        className="w-full rounded-xl border border-border bg-prism-card px-3 py-2.5 text-txt-primary outline-none transition-colors focus:border-cyan-400/60"
                        placeholder="Acme Industries"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-txt-secondary">
                      <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-prism-tertiary">Department Lead</span>
                      <input
                        value={form.departmentLead}
                        onChange={(event) => setForm((current) => ({ ...current, departmentLead: event.target.value }))}
                        className="w-full rounded-xl border border-border bg-prism-card px-3 py-2.5 text-txt-primary outline-none transition-colors focus:border-cyan-400/60"
                        placeholder="Jordan Lee"
                      />
                    </label>
                    <div className="lg:col-span-2 rounded-xl border border-border bg-prism-card/70 p-4 text-sm text-txt-secondary">
                      The activation service will provision tenant-scoped agents, roles, ABAC policies, disclosure defaults, autonomy defaults, and handoff contracts for this department.
                    </div>
                  </div>
                ) : null}

                {wizardStep === 2 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-txt-secondary">Optional: rename any pre-built agent before it is provisioned for this tenant.</p>
                    {detail.templates.map((template) => (
                      <label key={template.id} className="grid gap-2 rounded-xl border border-border bg-prism-card/70 p-4 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
                        <div>
                          <p className="font-semibold text-txt-primary">{template.templateName}</p>
                          <p className="text-sm text-txt-secondary">{toTitleCase(template.defaultRole)}</p>
                        </div>
                        <input
                          value={form.customAgentNames[template.id] ?? ''}
                          onChange={(event) => updateCustomName(template.id, event.target.value)}
                          className="w-full rounded-xl border border-border bg-prism-card px-3 py-2.5 text-txt-primary outline-none transition-colors focus:border-cyan-400/60"
                          placeholder={`Keep default or set a name for ${template.templateName}`}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="flex gap-2">
                    <ButtonGhost onClick={() => setWizardStep((current) => Math.max(0, current - 1))} disabled={wizardStep === 0 || submitting}>Back</ButtonGhost>
                    <ButtonOutlineSecondary
                      onClick={() => setWizardStep((current) => Math.min(2, current + 1))}
                      disabled={submitting || (wizardStep === 0 && !canAdvanceToStepTwo) || (wizardStep === 1 && !canAdvanceToStepThree) || wizardStep === 2}
                    >
                      Next Step
                    </ButtonOutlineSecondary>
                  </div>
                  <GradientButton
                    size="md"
                    onClick={() => void handleActivate()}
                    disabled={submitting || detail.status === 'active' || form.companyName.trim().length === 0 || form.departmentLead.trim().length === 0 || missingRequiredDomains.length > 0}
                  >
                    {submitting ? 'Activating...' : detail.status === 'active' ? 'Already Active' : 'Activate Department'}
                  </GradientButton>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <Card className="p-4" outline>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-prism-tertiary">Collaboration Surface</p>
                  {detail.agentsThatWillCollaborateWithExisting.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {detail.agentsThatWillCollaborateWithExisting.map((agentRole) => (
                        <Badge key={agentRole} color="cyan">{toTitleCase(agentRole)}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-txt-secondary">This department will start as a self-contained team until additional departments are activated.</p>
                  )}
                </Card>
                <Card className="p-4" outline>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-prism-tertiary">Expansion Queue</p>
                  <div className="mt-3 space-y-2">
                    {recommendations.slice(0, 3).map((recommendation) => (
                      <button
                        key={recommendation.departmentId}
                        type="button"
                        onClick={() => setSelectedDepartmentId(recommendation.departmentId)}
                        className="w-full rounded-xl border border-border px-3 py-2 text-left transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-txt-primary">{recommendation.departmentName}</span>
                          <span className="text-xs text-prism-tertiary">{recommendation.estimatedSetupMinutes} min</span>
                        </div>
                        <p className="mt-1 text-sm text-txt-secondary">{recommendation.whyRecommended}</p>
                      </button>
                    ))}
                    {recommendations.length === 0 ? (
                      <p className="text-sm text-txt-secondary">Expansion guidance will appear once the catalog has enough tenant state to rank the next department.</p>
                    ) : null}
                  </div>
                </Card>
              </div>
            </div>
          ) : (
            <p className="text-sm text-txt-secondary">Choose a department from the catalog to open its activation wizard.</p>
          )}
        </Card>
      </div>
    </div>
  );
}