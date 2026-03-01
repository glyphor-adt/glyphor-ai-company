/**
 * Meeting Engine — Multi-Agent Collaborative Discussions
 *
 * Orchestrates meetings between agents:
 *   1. Schedule  — Create meeting record, notify attendees
 *   2. Round 1   — Opening statements (each agent gives perspective)
 *   3. Round 2-N — Discussion (agents respond to each other)
 *   4. Synthesis  — Sarah summarizes, extracts action items
 *   5. Dispatch  — Action items emitted as task.requested events
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';

/* ── Types ──────────────────────────────────── */

export type MeetingType = 'discussion' | 'review' | 'planning' | 'incident' | 'standup';
export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface MeetingRequest {
  title: string;
  purpose: string;
  calledBy: string;
  attendees: string[];
  meetingType?: MeetingType;
  rounds?: number;
  agenda?: string[];
}

export interface TranscriptEntry {
  round: number;
  agent: string;
  content: string;
  timestamp: string;
}

export interface ActionItem {
  owner: string;
  action: string;
  deadline?: string;
}

export interface MeetingDecision {
  decision: string;
  tier: 'green' | 'yellow';
  rationale: string;
}

export interface MeetingEscalation {
  issue: string;
  why: string;
  urgency: 'low' | 'medium' | 'high';
}

export interface MeetingSynthesis {
  summary: string;
  key_points: string[];
  agreements: string[];
  disagreements: string[];
  action_items: ActionItem[];
  decisions_made: MeetingDecision[];
  escalations: MeetingEscalation[];
  follow_up_meeting: boolean;
}

export interface MeetingRecord {
  id: string;
  called_by: string;
  title: string;
  purpose: string;
  meeting_type: MeetingType;
  attendees: string[];
  status: MeetingStatus;
  rounds: number;
  agenda: string[];
  contributions: Record<string, string[]>;
  transcript: TranscriptEntry[];
  summary: string | null;
  action_items: ActionItem[];
  decisions_made: MeetingDecision[];
  escalations: MeetingEscalation[];
  total_cost: number;
  created_at: string;
  completed_at: string | null;
}

/* ── Rate Limits ────────────────────────────── */

const MAX_MEETINGS_PER_DAY = 10;
const MAX_ATTENDEES = 5;
const MAX_ROUNDS = 5;
const MIN_ROUNDS = 2;

/* ── Engine ─────────────────────────────────── */

export class MeetingEngine {
  constructor(
    private agentExecutor: (
      role: CompanyAgentRole,
      task: string,
      payload: Record<string, unknown>,
    ) => Promise<AgentExecutionResult | void>,
  ) {}

  /**
   * Schedule and run a meeting. Returns the meeting ID.
   * The meeting runs asynchronously after creation.
   */
  async launch(req: MeetingRequest): Promise<string> {
    // Validate attendees count
    if (req.attendees.length > MAX_ATTENDEES) {
      throw new Error(`Meeting cannot have more than ${MAX_ATTENDEES} attendees`);
    }

    // Validate rounds
    const rounds = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, req.rounds ?? 3));

    // Check daily meeting limit
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [{ count }] = await systemQuery<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_meetings WHERE created_at >= $1',
      [todayStart.toISOString()],
    );

    if ((count ?? 0) >= MAX_MEETINGS_PER_DAY) {
      throw new Error(`Daily meeting limit reached (${MAX_MEETINGS_PER_DAY})`);
    }

    const id = crypto.randomUUID();

    await systemQuery(
      `INSERT INTO agent_meetings (id, called_by, title, purpose, meeting_type, attendees, status, rounds, agenda)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        req.calledBy,
        req.title,
        req.purpose,
        req.meetingType ?? 'discussion',
        JSON.stringify(req.attendees),
        'scheduled',
        rounds,
        JSON.stringify(req.agenda ?? []),
      ],
    );

    // Run meeting asynchronously
    this.runMeeting(id).catch((err) => {
      console.error(`[MeetingEngine] Meeting ${id} failed:`, err);
      systemQuery('UPDATE agent_meetings SET status = $1 WHERE id = $2', ['cancelled', id]);
    });

    return id;
  }

  /** Get a meeting by ID. */
  async get(id: string): Promise<MeetingRecord | null> {
    const rows = await systemQuery<MeetingRecord>(
      'SELECT * FROM agent_meetings WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  /** List recent meetings. */
  async list(limit = 20): Promise<MeetingRecord[]> {
    return systemQuery<MeetingRecord>(
      'SELECT * FROM agent_meetings ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
  }

  /**
   * Run the full meeting flow: rounds → synthesis → dispatch.
   */
  private async runMeeting(meetingId: string): Promise<void> {
    const meeting = await this.get(meetingId);
    if (!meeting) throw new Error(`Meeting ${meetingId} not found`);

    const contributions: Record<string, string[]> = {};
    const transcript: TranscriptEntry[] = [];

    // Mark in-progress
    await systemQuery(
      'UPDATE agent_meetings SET status = $1 WHERE id = $2',
      ['in_progress', meetingId],
    );

    try {
      // ─── Round 1: Opening Statements ──────────────────────
      for (const agentId of meeting.attendees) {
        const result = await this.agentExecutor(
          agentId as CompanyAgentRole,
          'on_demand',
          {
            message: this.buildOpeningPrompt(meeting),
          },
        );

        const output = result?.output ?? '(no response)';
        contributions[agentId] = [output];
        transcript.push({
          round: 1,
          agent: agentId,
          content: output,
          timestamp: new Date().toISOString(),
        });

        // Update progress after each contribution
        await systemQuery(
          'UPDATE agent_meetings SET contributions = $1, transcript = $2 WHERE id = $3',
          [JSON.stringify(contributions), JSON.stringify(transcript), meetingId],
        );
      }

      // ─── Rounds 2-N: Discussion ──────────────────────────
      for (let round = 2; round <= meeting.rounds; round++) {
        for (const agentId of meeting.attendees) {
          const result = await this.agentExecutor(
            agentId as CompanyAgentRole,
            'on_demand',
            {
              message: this.buildDiscussionPrompt(meeting, transcript, round),
            },
          );

          const output = result?.output ?? '(no response)';
          contributions[agentId].push(output);
          transcript.push({
            round,
            agent: agentId,
            content: output,
            timestamp: new Date().toISOString(),
          });

          await systemQuery(
            'UPDATE agent_meetings SET contributions = $1, transcript = $2 WHERE id = $3',
            [JSON.stringify(contributions), JSON.stringify(transcript), meetingId],
          );
        }
      }

      // ─── Synthesis: Sarah summarizes ──────────────────────
      const synthesisResult = await this.agentExecutor(
        'chief-of-staff' as CompanyAgentRole,
        'on_demand',
        {
          message: this.buildSynthesisPrompt(meeting, transcript),
        },
      );

      const synthesis = this.parseSynthesis(synthesisResult?.output ?? '');

      // ─── Dispatch action items as messages ────────────────
      for (const item of synthesis.action_items) {
        await systemQuery(
          `INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, context)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            meeting.called_by,
            item.owner,
            `Action from meeting "${meeting.title}": ${item.action}${item.deadline ? ` (deadline: ${item.deadline})` : ''}`,
            'request',
            'normal',
            JSON.stringify({ meeting_id: meetingId, type: 'action_item' }),
          ],
        );
      }

      // ─── Store results ────────────────────────────────────
      await systemQuery(
        `UPDATE agent_meetings
         SET status = $1, contributions = $2, transcript = $3, summary = $4,
             action_items = $5, decisions_made = $6, escalations = $7, completed_at = $8
         WHERE id = $9`,
        [
          'completed',
          JSON.stringify(contributions),
          JSON.stringify(transcript),
          synthesis.summary,
          JSON.stringify(synthesis.action_items),
          JSON.stringify(synthesis.decisions_made),
          JSON.stringify(synthesis.escalations),
          new Date().toISOString(),
          meetingId,
        ],
      );

      console.log(
        `[MeetingEngine] Meeting "${meeting.title}" completed. ` +
        `${synthesis.action_items.length} action items, ${synthesis.escalations.length} escalations.`,
      );

    } catch (err) {
      await systemQuery(
        'UPDATE agent_meetings SET status = $1, contributions = $2, transcript = $3 WHERE id = $4',
        ['cancelled', JSON.stringify(contributions), JSON.stringify(transcript), meetingId],
      );
      throw err;
    }
  }

  /* ── Prompt Builders ──────────────────────── */

  private buildOpeningPrompt(meeting: MeetingRecord): string {
    const agendaText = meeting.agenda.length > 0
      ? meeting.agenda.map((item, i) => `${i + 1}. ${item}`).join('\n')
      : '(open discussion)';

    return `You are in a MEETING. Respond in character.

MEETING: "${meeting.title}"
Called by: ${meeting.called_by}
Purpose: ${meeting.purpose}
Type: ${meeting.meeting_type}
Attendees: ${meeting.attendees.join(', ')}

Agenda:
${agendaText}

This is Round 1 — opening statements.
Share your perspective on the agenda items from your area of expertise.
Be direct, opinionated, and specific. Reference real data when you have it.
If you disagree with the premise, say so.
Address other attendees by name when relevant.

Keep your response focused (2-4 paragraphs). This is a conversation, not a report.`;
  }

  private buildDiscussionPrompt(
    meeting: MeetingRecord,
    transcript: TranscriptEntry[],
    round: number,
  ): string {
    const transcriptText = transcript
      .map((t) => `[Round ${t.round}] ${t.agent}: ${t.content}`)
      .join('\n\n');

    const isFinal = round === meeting.rounds;

    return `You are in a MEETING. Respond in character.

MEETING: "${meeting.title}" — Round ${round} of ${meeting.rounds}

Previous discussion:
${transcriptText}

Respond to what others have said. You can:
- Agree and build on someone's point
- Disagree and explain why with data
- Propose a specific action or solution
- Ask a clarifying question
- Change your position based on new information

${isFinal
  ? 'This is the FINAL round. State your final position clearly and any action items you commit to.'
  : 'Keep the discussion moving forward.'}

Speak naturally — this is a conversation, not a report. Keep it to 2-3 paragraphs.`;
  }

  private buildSynthesisPrompt(
    meeting: MeetingRecord,
    transcript: TranscriptEntry[],
  ): string {
    const transcriptText = transcript
      .map((t) => `[Round ${t.round}] ${t.agent}: ${t.content}`)
      .join('\n\n');

    return `Summarize this meeting for the founders.

Meeting: "${meeting.title}"
Called by: ${meeting.called_by}
Type: ${meeting.meeting_type}
Attendees: ${meeting.attendees.join(', ')}

Full transcript:
${transcriptText}

Return ONLY a JSON object (no markdown fencing, no extra text):
{
  "summary": "2-3 sentence overview of what happened",
  "key_points": ["what was discussed and decided"],
  "agreements": ["what everyone aligned on"],
  "disagreements": ["unresolved tensions — be honest"],
  "action_items": [
    { "owner": "agent-role-slug", "action": "specific task", "deadline": "timeframe or null" }
  ],
  "decisions_made": [
    { "decision": "what was decided", "tier": "green", "rationale": "why" }
  ],
  "escalations": [
    { "issue": "what needs founder input", "why": "reason", "urgency": "low" }
  ],
  "follow_up_meeting": false
}`;
  }

  private parseSynthesis(output: string): MeetingSynthesis {
    const fallback: MeetingSynthesis = {
      summary: output.slice(0, 500),
      key_points: [],
      agreements: [],
      disagreements: [],
      action_items: [],
      decisions_made: [],
      escalations: [],
      follow_up_meeting: false,
    };

    try {
      const cleaned = output
        .replace(/```json?\n?/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      return {
        summary: parsed.summary ?? fallback.summary,
        key_points: parsed.key_points ?? [],
        agreements: parsed.agreements ?? [],
        disagreements: parsed.disagreements ?? [],
        action_items: (parsed.action_items ?? []).map((ai: Record<string, string>) => ({
          owner: ai.owner ?? '',
          action: ai.action ?? '',
          deadline: ai.deadline ?? null,
        })),
        decisions_made: (parsed.decisions_made ?? []).map((d: Record<string, string>) => ({
          decision: d.decision ?? '',
          tier: d.tier === 'yellow' ? 'yellow' : 'green',
          rationale: d.rationale ?? '',
        })),
        escalations: (parsed.escalations ?? []).map((e: Record<string, string>) => ({
          issue: e.issue ?? '',
          why: e.why ?? '',
          urgency: ['low', 'medium', 'high'].includes(e.urgency) ? e.urgency : 'low',
        })),
        follow_up_meeting: parsed.follow_up_meeting ?? false,
      };
    } catch {
      console.warn('[MeetingEngine] Failed to parse synthesis output, using fallback');
      return fallback;
    }
  }
}
