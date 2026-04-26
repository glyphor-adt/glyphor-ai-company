import { useEffect, useState } from 'react';
import Settings from './Settings';
import { useSmbSettings } from '../lib/smb';
import { AgentAvatar, Badge, Card, GradientButton, SectionHeader } from '../components/ui';
import { Button } from '@/components/ui/button';

type AccordionKey = 'team' | 'work' | 'integrations' | 'brand' | 'advanced';

function AccordionSection({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <Button variant="ghost" onClick={onToggle} className="flex w-full items-start justify-between gap-4 text-left">
        <div>
          <p className="text-base font-semibold text-txt-primary">{title}</p>
          <p className="mt-1 text-sm text-txt-secondary">{subtitle}</p>
        </div>
        <span className="text-sm text-cyan">{open ? 'Hide' : 'Show'}</span>
      </Button>
      {open && <div className="mt-5">{children}</div>}
    </Card>
  );
}

export default function SmbSettings() {
  const { data, loading, saving, update } = useSmbSettings();
  const [open, setOpen] = useState<Record<AccordionKey, boolean>>({
    team: true,
    work: false,
    integrations: false,
    brand: false,
    advanced: false,
  });
  const [drafts, setDrafts] = useState({
    communication_style: '',
    approval_preference: '',
    focus_areas: '',
    website: '',
    brand_voice: '',
    target_audience: '',
    differentiators: '',
    notes: '',
  });

  useEffect(() => {
    if (!data) return;
    setDrafts({
      communication_style: data.work.communication_style,
      approval_preference: data.work.approval_preference,
      focus_areas: data.work.focus_areas.join(', '),
      website: data.brand_context.website,
      brand_voice: data.brand_context.brand_voice,
      target_audience: data.brand_context.target_audience,
      differentiators: data.brand_context.differentiators,
      notes: data.brand_context.notes,
    });
  }, [data]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Settings" subtitle="Loading your team settings..." />
      </div>
    );
  }

  async function toggleDepartment(department: string) {
    if (!data) return;
    const next = data.team.active_departments.includes(department)
      ? data.team.active_departments.filter((item) => item !== department)
      : [...data.team.active_departments, department];
    await update({ team: { active_departments: next } });
  }

  async function toggleIntegration(key: 'slack' | 'teams' | 'google_workspace' | 'hubspot') {
    if (!data) return;
    await update({ integrations: { [key]: { connected: !data.integrations[key] } } });
  }

  async function saveWork() {
    await update({
      work: {
        communication_style: drafts.communication_style,
        approval_preference: drafts.approval_preference,
        focus_areas: drafts.focus_areas.split(',').map((item) => item.trim()).filter(Boolean),
      },
    });
  }

  async function saveBrand() {
    await update({
      website: drafts.website,
      brand_voice: drafts.brand_voice,
      brand_context: {
        target_audience: drafts.target_audience,
        differentiators: drafts.differentiators,
        notes: drafts.notes,
      },
    });
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" subtitle="Manage how your simple view works." />

      <AccordionSection
        title="Your team"
        subtitle="Choose which departments appear in the simple view."
        open={open.team}
        onToggle={() => setOpen((current) => ({ ...current, team: !current.team }))}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {data.team.available_departments.map((department) => {
              const enabled = data.team.active_departments.includes(department);
              return (
                <Button
                  key={department}
                  variant="ghost"
                  onClick={() => toggleDepartment(department)}
                  className={`rounded-full border px-3 py-2 text-sm transition-colors ${enabled ? 'border-cyan bg-cyan/15 text-cyan' : 'border-border text-txt-secondary hover:text-txt-primary'}`}
                >
                  {department}
                </Button>
              );
            })}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.team.roster
              .filter((agent) => !agent.department || data.team.active_departments.includes(agent.department))
              .slice(0, 8)
              .map((agent) => (
                <div key={agent.role} className="rounded-xl border border-border bg-base/50 p-4">
                  <div className="flex items-center gap-3">
                    <AgentAvatar role={agent.role} avatarUrl={agent.avatar_url} size={44} />
                    <div>
                      <p className="text-sm font-semibold text-txt-primary">{agent.display_name}</p>
                      <p className="text-xs text-txt-muted">{agent.title || agent.department || 'Team member'}</p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
          <div className="rounded-xl border border-border bg-base/50 p-4">
            <p className="text-sm font-semibold text-txt-primary">Authorized people</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.team.authorized_users.map((person) => (
                <Badge key={person.email} color={person.role === 'admin' ? 'cyan' : 'gray'}>{person.name || person.email}</Badge>
              ))}
            </div>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        title="How your team works"
        subtitle="Set the tone for how work is delivered and reviewed."
        open={open.work}
        onToggle={() => setOpen((current) => ({ ...current, work: !current.work }))}
      >
        <div className="space-y-4">
          <label className="block text-sm text-txt-secondary">
            Communication style
            <textarea
              value={drafts.communication_style}
              onChange={(event) => setDrafts((current) => ({ ...current, communication_style: event.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <label className="block text-sm text-txt-secondary">
            Approval preference
            <textarea
              value={drafts.approval_preference}
              onChange={(event) => setDrafts((current) => ({ ...current, approval_preference: event.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <label className="block text-sm text-txt-secondary">
            Focus areas
            <input
              value={drafts.focus_areas}
              onChange={(event) => setDrafts((current) => ({ ...current, focus_areas: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <div className="flex justify-end">
            <GradientButton onClick={saveWork} disabled={saving} size="md">Save team workflow</GradientButton>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        title="Integrations"
        subtitle="Track which tools are connected for your team."
        open={open.integrations}
        onToggle={() => setOpen((current) => ({ ...current, integrations: !current.integrations }))}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { key: 'slack', label: 'Slack' },
            { key: 'teams', label: 'Microsoft Teams' },
            { key: 'google_workspace', label: 'Google Workspace' },
            { key: 'hubspot', label: 'HubSpot' },
          ].map((integration) => {
            const connected = data.integrations[integration.key as keyof typeof data.integrations];
            return (
              <div key={integration.key} className="rounded-xl border border-border bg-base/50 p-4">
                <p className="text-sm font-semibold text-txt-primary">{integration.label}</p>
                <p className="mt-2 text-sm text-txt-secondary">{connected ? 'Connected and ready to use.' : 'Not connected yet.'}</p>
                <Button
                  variant="outline"
                  onClick={() => toggleIntegration(integration.key as 'slack' | 'teams' | 'google_workspace' | 'hubspot')}
                  className="mt-4 rounded-lg border border-border px-3 py-2 text-sm font-medium text-txt-primary transition-colors hover:border-border-hover hover:bg-base"
                >
                  {connected ? 'Disconnect' : 'Connect'}
                </Button>
              </div>
            );
          })}
        </div>
      </AccordionSection>

      <AccordionSection
        title="Brand context"
        subtitle="Keep your team aligned with your voice, audience, and messaging."
        open={open.brand}
        onToggle={() => setOpen((current) => ({ ...current, brand: !current.brand }))}
      >
        <div className="space-y-4">
          <label className="block text-sm text-txt-secondary">
            Website
            <input
              value={drafts.website}
              onChange={(event) => setDrafts((current) => ({ ...current, website: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <label className="block text-sm text-txt-secondary">
            Brand voice
            <textarea
              value={drafts.brand_voice}
              onChange={(event) => setDrafts((current) => ({ ...current, brand_voice: event.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <label className="block text-sm text-txt-secondary">
            Target audience
            <textarea
              value={drafts.target_audience}
              onChange={(event) => setDrafts((current) => ({ ...current, target_audience: event.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <label className="block text-sm text-txt-secondary">
            Differentiators
            <textarea
              value={drafts.differentiators}
              onChange={(event) => setDrafts((current) => ({ ...current, differentiators: event.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <label className="block text-sm text-txt-secondary">
            Notes for the team
            <textarea
              value={drafts.notes}
              onChange={(event) => setDrafts((current) => ({ ...current, notes: event.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            />
          </label>
          <div className="flex justify-end">
            <GradientButton onClick={saveBrand} disabled={saving} size="md">Save brand context</GradientButton>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        title="Advanced settings"
        subtitle="Open the existing internal settings tools without changing your default view."
        open={open.advanced}
        onToggle={() => setOpen((current) => ({ ...current, advanced: !current.advanced }))}
      >
        <Settings />
      </AccordionSection>
    </div>
  );
}