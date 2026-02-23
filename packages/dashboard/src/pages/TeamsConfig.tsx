import { useEffect, useState } from 'react';

/**
 * Teams Tab Configuration Page
 *
 * Shown when a user adds the Glyphor app as a configurable tab in a Teams channel.
 * Lets them pick which dashboard page to embed.
 */

const PAGES = [
  { id: '/', label: 'Dashboard', description: 'Executive overview with KPIs and activity' },
  { id: '/chat', label: 'Agent Chat', description: '1:1 conversations with any agent' },
  { id: '/approvals', label: 'Approvals', description: 'Decision approval queue' },
  { id: '/workforce', label: 'Workforce', description: 'Org chart and agent hierarchy' },
  { id: '/financials', label: 'Financials', description: 'Revenue, costs, and unit economics' },
  { id: '/operations', label: 'Operations', description: 'System health and agent runs' },
  { id: '/strategy', label: 'Strategy', description: 'Analyses and simulations' },
  { id: '/meetings', label: 'Meetings', description: 'Agent meetings and discussions' },
] as const;

export default function TeamsConfig() {
  const [selected, setSelected] = useState('/');

  useEffect(() => {
    // Notify Teams SDK that configuration is ready
    // The Teams JS SDK would be loaded via script tag in index.html when teamsTab=true
    const microsoftTeams = (window as unknown as Record<string, unknown>).microsoftTeams as
      | { settings?: { setValidityState: (v: boolean) => void; registerOnSaveHandler: (h: (e: { notifySuccess: () => void }) => void) => void; setSettings: (s: unknown) => void } }
      | undefined;

    if (microsoftTeams?.settings) {
      const settings = microsoftTeams.settings;
      settings.setValidityState(true);
      settings.registerOnSaveHandler((saveEvent) => {
        const baseUrl = window.location.origin;
        settings.setSettings({
          entityId: selected,
          contentUrl: `${baseUrl}${selected}?teamsTab=true`,
          websiteUrl: `${baseUrl}${selected}`,
          suggestedDisplayName: PAGES.find((p) => p.id === selected)?.label ?? 'Glyphor',
        });
        saveEvent.notifySuccess();
      });
    }
  }, [selected]);

  return (
    <div className="min-h-screen bg-base p-8">
      <h1 className="text-xl font-semibold text-txt-primary mb-2">
        Configure Glyphor Tab
      </h1>
      <p className="text-sm text-txt-muted mb-6">
        Choose which dashboard page to display in this channel tab.
      </p>

      <div className="space-y-2 max-w-md">
        {PAGES.map((page) => (
          <button
            key={page.id}
            onClick={() => setSelected(page.id)}
            className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
              selected === page.id
                ? 'border-cyan/40 bg-cyan/10'
                : 'border-border bg-raised hover:bg-[var(--color-hover-bg)]'
            }`}
          >
            <div
              className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                selected === page.id ? 'border-cyan' : 'border-txt-faint'
              }`}
            >
              {selected === page.id && (
                <div className="h-2 w-2 rounded-full bg-cyan" />
              )}
            </div>
            <div>
              <p className={`text-sm font-medium ${selected === page.id ? 'text-cyan' : 'text-txt-secondary'}`}>
                {page.label}
              </p>
              <p className="text-[11px] text-txt-faint">{page.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
