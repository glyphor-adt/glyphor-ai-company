import { useEffect, useState, useCallback, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import {
  MdForum, MdAssignment, MdSquareFoot, MdNotificationImportant,
  MdPerson, MdWarning, MdArrowForward,
} from 'react-icons/md';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { Card, SectionHeader, Skeleton, timeAgo } from '../components/ui';
import { DISPLAY_NAME_MAP } from '../lib/types';

/* ── Types ─────────────────────────────────────── */

type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
type MeetingType = 'discussion' | 'review' | 'planning' | 'incident' | 'standup';

interface TranscriptEntry {
  round: number;
  agent: string;
  content: string;
  timestamp: string;
}

interface ActionItem {
  owner: string;
  action: string;
  deadline?: string | null;
}

interface MeetingRecord {
  id: string;
  called_by: string;
  title: string;
  purpose: string;
  meeting_type: MeetingType;
  attendees: string[];
  status: MeetingStatus;
  rounds: number;
  transcript: TranscriptEntry[] | null;
  summary: string | null;
  action_items: ActionItem[] | null;
  decisions_made: { decision: string; tier: string; rationale: string }[] | null;
  escalations: { issue: string; why: string; urgency: string }[] | null;
  total_cost: number | null;
  created_at: string;
  completed_at: string | null;
}

interface MessageRecord {
  id: string;
  from_agent: string;
  to_agent: string;
  thread_id: string;
  message: string;
  message_type: string;
  priority: string;
  status: string;
  response: string | null;
  created_at: string;
}

/* ── Page ──────────────────────────────────────── */

export default function Meetings() {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [meetData, msgData] = await Promise.all([
      apiCall<MeetingRecord[]>('/api/agent-meetings?limit=30'),
      apiCall<MessageRecord[]>('/api/agent-messages?limit=50'),
    ]);
    setMeetings(meetData ?? []);
    setMessages(msgData ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh for in-progress meetings
  useEffect(() => {
    const hasActive = meetings.some((m) => m.status === 'in_progress' || m.status === 'scheduled');
    if (!hasActive) return;
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [meetings, load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const completedMeetings = meetings.filter((m) => m.status === 'completed');
  const totalActionItems = completedMeetings.reduce((s, m) => s + (m.action_items?.length ?? 0), 0);
  const totalEscalations = completedMeetings.reduce((s, m) => s + (m.escalations?.length ?? 0), 0);
  const pendingMessages = messages.filter((m) => m.status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Meetings', value: meetings.length, color: '#00E0FF' },
          { label: 'Completed', value: completedMeetings.length, color: '#C084FC' },
          { label: 'Action Items', value: totalActionItems, color: '#7DD3FC' },
          { label: 'Escalations', value: totalEscalations, color: '#A855F7' },
          { label: 'Pending Messages', value: pendingMessages, color: '#3730A3' },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3" style={{ borderTopColor: s.color, borderTopWidth: '2px' }}>
            <p className="text-xl font-bold text-txt-primary">{s.value}</p>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: s.color }}>{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Meeting Timeline */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Meeting Timeline</h3>
        {meetings.length === 0 ? (
          <p className="text-sm text-txt-faint">No meetings yet. Agents can call meetings using the call_meeting tool.</p>
        ) : (
          <div className="space-y-3">
            {meetings.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                isExpanded={expanded === m.id}
                onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Recent Messages */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Recent Agent Messages</h3>
        {messages.length === 0 ? (
          <p className="text-sm text-txt-faint">No messages yet. Agents can send messages using the send_agent_message tool.</p>
        ) : (
          <div className="space-y-2">
            {messages.slice(0, 30).map((msg) => (
              <MessageRow key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Meeting Card ─────────────────────────────── */

function MeetingCard({
  meeting,
  isExpanded,
  onToggle,
}: {
  meeting: MeetingRecord;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusColor: Record<MeetingStatus, string> = {
    scheduled: 'bg-prism-fill-3/15 text-prism-sky',
    in_progress: 'bg-prism-elevated/15 text-prism-elevated',
    completed: 'bg-tier-green/15 text-tier-green',
    cancelled: 'bg-prism-critical/15 text-prism-critical',
  };

  const typeIcon: Record<MeetingType, ReactNode> = {
    discussion: <MdForum className="inline h-5 w-5 text-prism-sky" />,
    review: <MdAssignment className="inline h-5 w-5 text-prism-violet" />,
    planning: <MdSquareFoot className="inline h-5 w-5 text-cyan" />,
    incident: <MdNotificationImportant className="inline h-5 w-5 text-prism-critical" />,
    standup: <MdPerson className="inline h-5 w-5 text-tier-green" />,
  };

  return (
    <div className="glass-card rounded-lg border border-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-raised/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{typeIcon[meeting.meeting_type] ?? <MdForum className="inline h-5 w-5 text-prism-sky" />}</span>
          <div>
            <p className="text-sm font-medium text-txt-primary">{meeting.title}</p>
            <p className="text-[11px] text-txt-faint">
              Called by {DISPLAY_NAME_MAP[meeting.called_by] ?? meeting.called_by}
              <span className="mx-1">·</span>
              {meeting.attendees.length} attendees
              <span className="mx-1">·</span>
              {timeAgo(meeting.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${statusColor[meeting.status]}`}>
            {meeting.status === 'in_progress' ? 'in progress' : meeting.status}
          </span>
          <span className="text-txt-faint transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▸</span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {/* Purpose */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Purpose</p>
            <p className="mt-1 text-sm text-txt-secondary">{meeting.purpose}</p>
          </div>

          {/* Attendees */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Attendees</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {meeting.attendees.map((a) => (
                <span key={a} className="rounded-full border border-border bg-raised px-2.5 py-0.5 text-[11px] text-txt-secondary">
                  {DISPLAY_NAME_MAP[a] ?? a}
                </span>
              ))}
            </div>
          </div>

          {/* Summary */}
          {meeting.summary && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Summary</p>
              <div className="mt-1 text-sm text-txt-secondary leading-relaxed prose-chat"><Markdown>{meeting.summary}</Markdown></div>
            </div>
          )}

          {/* Action Items */}
          {meeting.action_items && meeting.action_items.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Action Items</p>
              <ul className="mt-1 space-y-1.5">
                {meeting.action_items.map((ai, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                    <MdArrowForward className="text-cyan" />
                    <span>
                      <span className="font-medium text-txt-primary">{DISPLAY_NAME_MAP[ai.owner] ?? ai.owner}:</span>{' '}
                      {ai.action}
                      {ai.deadline && <span className="ml-1 text-txt-faint">({ai.deadline})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decisions */}
          {meeting.decisions_made && meeting.decisions_made.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Decisions</p>
              <ul className="mt-1 space-y-1.5">
                {meeting.decisions_made.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                    <span className={d.tier === 'yellow' ? 'text-tier-yellow' : 'text-tier-green'}>●</span>
                    <span>{d.decision}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Escalations */}
          {meeting.escalations && meeting.escalations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Escalations</p>
              <ul className="mt-1 space-y-1.5">
                {meeting.escalations.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                    <MdWarning className="h-4 w-4 text-tier-red" />
                    <span>
                      {e.issue}
                      <span className="ml-1 text-txt-faint">— {e.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Transcript (collapsible) */}
          {meeting.transcript && meeting.transcript.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-txt-faint hover:text-cyan transition-colors">
                Transcript ({meeting.transcript.length} contributions)
              </summary>
              <div className="mt-2 space-y-2 max-h-96 overflow-y-auto">
                {meeting.transcript.map((t, i) => (
                  <div key={i} className="rounded-lg border border-border/50 px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-medium text-cyan">{DISPLAY_NAME_MAP[t.agent] ?? t.agent}</span>
                      <span className="text-[10px] text-txt-faint">Round {t.round}</span>
                    </div>
                    <div className="text-sm text-txt-secondary prose-chat"><Markdown>{t.content}</Markdown></div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Message Row ──────────────────────────────── */

function MessageRow({ message }: { message: MessageRecord }) {
  const typeColor: Record<string, string> = {
    request: 'bg-prism-fill-3/15 text-prism-sky',
    response: 'bg-tier-green/15 text-tier-green',
    info: 'bg-prism-moderate/15 text-prism-moderate',
    followup: 'bg-prism-violet/15 text-prism-violet',
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/50 px-3 py-2.5">
      <div className="mt-0.5 flex flex-col items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${typeColor[message.message_type] ?? typeColor.info}`}>
          {message.message_type}
        </span>
        {message.priority === 'urgent' && (
          <span className="rounded-full bg-prism-critical/15 px-1.5 py-0.5 text-[9px] font-bold text-prism-critical">URGENT</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-txt-faint">
          <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[message.from_agent] ?? message.from_agent}</span>
          <MdArrowForward className="mx-1" />
          <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[message.to_agent] ?? message.to_agent}</span>
          <span className="ml-2">{timeAgo(message.created_at)}</span>
        </p>
        <div className="mt-0.5 text-sm text-txt-secondary line-clamp-2 prose-chat"><Markdown>{message.message}</Markdown></div>
      </div>
      <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
        message.status === 'pending' ? 'bg-cyan' : message.status === 'read' ? 'bg-prism-moderate' : 'bg-tier-green'
      }`} />
    </div>
  );
}
