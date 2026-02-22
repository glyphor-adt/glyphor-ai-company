import { DISPLAY_NAME_MAP } from '../lib/types';
import { AgentAvatar, timeAgo } from './ui';

interface Feedback {
  id: string;
  from_agent: string;
  to_agent: string;
  feedback: string;
  context: string | null;
  sentiment: string;
  created_at: string;
}

export function PeerFeedback({ data }: { data: Feedback[] }) {
  if (!data.length) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-txt-faint">
        No peer feedback yet
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {data.map((fb) => {
        const name = DISPLAY_NAME_MAP[fb.from_agent] ?? fb.from_agent;
        const sentimentBorder =
          fb.sentiment === 'positive' ? 'border-l-tier-green' :
          fb.sentiment === 'constructive' ? 'border-l-tier-yellow' :
          'border-l-border';

        return (
          <li key={fb.id} className={`border-l-2 pl-3 ${sentimentBorder}`}>
            <div className="flex items-center gap-2">
              <AgentAvatar role={fb.from_agent} size={24} />
              <span className="text-sm font-medium text-txt-primary">{name}</span>
              <span className="text-[11px] text-txt-faint">{timeAgo(fb.created_at)}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-txt-secondary">"{fb.feedback}"</p>
          </li>
        );
      })}
    </ul>
  );
}
