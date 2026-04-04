import { useMemo } from 'react';
import { MdOpenInNew } from 'react-icons/md';

/** Matches Vercel previews, Glyphor Cloudflare aliases, and common static hosts. Teams/Slack cannot embed these — dashboard only. */
const TRUSTED_PREVIEW_HOST_SUFFIXES = [
  '.vercel.app',
  '.glyphor.ai',
  '.now.sh',
  '.pages.dev',
  '.netlify.app',
  '.cloudflarepages.dev',
  '.workers.dev',
] as const;

export type DashboardChatEmbed = {
  kind: 'iframe_preview';
  url: string;
  label?: string;
};

export function isTrustedDashboardPreviewUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local')) return false;
    return TRUSTED_PREVIEW_HOST_SUFFIXES.some((s) => h.endsWith(s));
  } catch {
    return false;
  }
}

export default function DashboardChatIframe({ embed }: { embed: DashboardChatEmbed }) {
  const safe = useMemo(() => isTrustedDashboardPreviewUrl(embed.url), [embed.url]);

  if (!safe) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-txt-secondary">
        Preview URL is not on an allowlisted host — open in a new tab instead:{' '}
        <a href={embed.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline break-all">
          {embed.url}
        </a>
      </div>
    );
  }

  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-border bg-base/40">
      <div className="flex items-center justify-between gap-2 border-b border-border/80 bg-surface/60 px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-txt-muted">{embed.label ?? 'Live preview'}</span>
        <a
          href={embed.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[11px] text-cyan-400 hover:underline"
        >
          <MdOpenInNew size={14} aria-hidden />
          Open
        </a>
      </div>
      <iframe
        title={embed.label ?? 'Web preview'}
        src={embed.url}
        className="h-[min(420px,55vh)] w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <p className="border-t border-border/60 px-2 py-1 text-[10px] text-txt-faint">
        Dashboard-only embed. If the frame stays blank, the host may block iframes — use Open.
      </p>
    </div>
  );
}
