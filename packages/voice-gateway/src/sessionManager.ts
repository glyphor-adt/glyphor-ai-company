/**
 * Voice Session Manager — Tracks active voice sessions, enforces limits, records usage
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import type { VoiceSession, VoiceSessionMode, VoiceUsageRecord, VoiceUsageSummary } from './types.js';
import { VOICE_LIMITS } from './types.js';
import { randomUUID } from 'node:crypto';

export class SessionManager {
  private sessions = new Map<string, VoiceSession>();
  private usageRecords: VoiceUsageRecord[] = [];
  /** Timer handles for auto-disconnect */
  private timers = new Map<string, NodeJS.Timeout>();
  /** Callback invoked when a session auto-disconnects */
  onAutoEnd?: (session: VoiceSession) => void;

  create(
    agentRole: CompanyAgentRole,
    mode: VoiceSessionMode,
    opts: { userId?: string; chatId?: string; meetingUrl?: string } = {},
  ): VoiceSession {
    const id = randomUUID();
    const session: VoiceSession = {
      id,
      agentRole,
      mode,
      createdAt: Date.now(),
      durationSec: 0,
      userId: opts.userId,
      chatId: opts.chatId,
      meetingUrl: opts.meetingUrl,
      active: true,
    };
    this.sessions.set(id, session);

    // Auto-end timer
    const timeout = setTimeout(() => {
      this.end(id);
      if (this.onAutoEnd) this.onAutoEnd(session);
    }, VOICE_LIMITS.maxSessionDurationSec * 1000);
    this.timers.set(id, timeout);

    return session;
  }

  get(sessionId: string): VoiceSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session?.active) {
      session.durationSec = Math.round((Date.now() - session.createdAt) / 1000);
    }
    return session;
  }

  end(sessionId: string): VoiceUsageRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return undefined;

    session.active = false;
    session.durationSec = Math.round((Date.now() - session.createdAt) / 1000);

    // Clear auto-end timer
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }

    // Record usage
    const durationMin = session.durationSec / 60;
    const estimatedCost =
      durationMin * VOICE_LIMITS.audioInputPerMin +
      (durationMin * 0.4) * VOICE_LIMITS.audioOutputPerMin; // assume agent speaks ~40% of the time

    const record: VoiceUsageRecord = {
      sessionId: session.id,
      agentRole: session.agentRole,
      mode: session.mode,
      durationSec: session.durationSec,
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      userId: session.userId ?? 'unknown',
      startedAt: new Date(session.createdAt).toISOString(),
      endedAt: new Date().toISOString(),
    };
    this.usageRecords.push(record);
    return record;
  }

  getActiveSessions(): VoiceSession[] {
    return [...this.sessions.values()].filter((s) => s.active).map((s) => {
      s.durationSec = Math.round((Date.now() - s.createdAt) / 1000);
      return s;
    });
  }

  getActiveForAgent(agentRole: CompanyAgentRole): VoiceSession | undefined {
    return [...this.sessions.values()].find((s) => s.active && s.agentRole === agentRole);
  }

  /** Check daily usage limits */
  canStartSession(): { allowed: boolean; reason?: string } {
    const today = new Date().toISOString().slice(0, 10);
    const todayMinutes = this.usageRecords
      .filter((r) => r.startedAt.startsWith(today))
      .reduce((sum, r) => sum + r.durationSec / 60, 0);

    // Also count currently active sessions
    const activeMinutes = this.getActiveSessions()
      .reduce((sum, s) => sum + s.durationSec / 60, 0);

    const totalMinutes = todayMinutes + activeMinutes;

    if (totalMinutes >= VOICE_LIMITS.maxDailyMinutes) {
      return { allowed: false, reason: `Daily voice limit reached (${Math.round(totalMinutes)} min / ${VOICE_LIMITS.maxDailyMinutes} min)` };
    }
    return { allowed: true };
  }

  /** Get today's usage summary */
  getDailyUsage(): VoiceUsageSummary {
    const today = new Date().toISOString().slice(0, 10);
    const todayRecords = this.usageRecords.filter((r) => r.startedAt.startsWith(today));

    const byAgent: Record<string, { minutes: number; cost: number }> = {};
    let totalMinutes = 0;
    let totalCost = 0;

    for (const record of todayRecords) {
      const minutes = record.durationSec / 60;
      totalMinutes += minutes;
      totalCost += record.estimatedCost;
      if (!byAgent[record.agentRole]) byAgent[record.agentRole] = { minutes: 0, cost: 0 };
      byAgent[record.agentRole].minutes += minutes;
      byAgent[record.agentRole].cost += record.estimatedCost;
    }

    // Include active sessions
    for (const session of this.getActiveSessions()) {
      const minutes = session.durationSec / 60;
      const cost = minutes * VOICE_LIMITS.audioInputPerMin + (minutes * 0.4) * VOICE_LIMITS.audioOutputPerMin;
      totalMinutes += minutes;
      totalCost += cost;
      if (!byAgent[session.agentRole]) byAgent[session.agentRole] = { minutes: 0, cost: 0 };
      byAgent[session.agentRole].minutes += minutes;
      byAgent[session.agentRole].cost += cost;
    }

    return {
      totalMinutes: Math.round(totalMinutes * 10) / 10,
      totalCost: Math.round(totalCost * 100) / 100,
      byAgent,
    };
  }
}
