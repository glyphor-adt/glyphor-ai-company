/**
 * Voice Gateway — Types
 *
 * Shared types for the voice system (Dashboard WebRTC + Teams ACS).
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';

// ═══════════════════════════════════════════════════════════════════
// AGENT VOICE CONFIG
// ═══════════════════════════════════════════════════════════════════

/** OpenAI Realtime voice IDs (gpt-4o-realtime-preview voices) */
export type RealtimeVoice =
  | 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo'
  | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';

export interface AgentVoiceConfig {
  role: CompanyAgentRole;
  displayName: string;
  voice: RealtimeVoice;
  title: string;
}

// ═══════════════════════════════════════════════════════════════════
// VOICE SESSION
// ═══════════════════════════════════════════════════════════════════

export type VoiceSessionMode = 'dashboard' | 'teams';

export interface VoiceSession {
  id: string;
  agentRole: CompanyAgentRole;
  mode: VoiceSessionMode;
  createdAt: number;
  /** Duration in seconds since session started */
  durationSec: number;
  /** OpenAI Realtime session ID */
  realtimeSessionId?: string;
  /** ACS call connection ID (Teams mode only) */
  callConnectionId?: string;
  /** User who initiated this session */
  userId?: string;
  /** Chat ID to persist transcripts (Dashboard mode) */
  chatId?: string;
  /** Teams meeting URL (Teams mode only) */
  meetingUrl?: string;
  active: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD VOICE API
// ═══════════════════════════════════════════════════════════════════

export interface DashboardVoiceRequest {
  agentRole: CompanyAgentRole;
  userId: string;
  chatId?: string;
}

export interface DashboardVoiceResponse {
  sessionId: string;
  clientSecret: string;
  voice: RealtimeVoice;
  agentDisplayName: string;
}

// ═══════════════════════════════════════════════════════════════════
// TEAMS VOICE API
// ═══════════════════════════════════════════════════════════════════

export interface TeamsJoinRequest {
  agentRole: CompanyAgentRole;
  meetingUrl: string;
  invitedBy?: string;
}

export interface TeamsJoinResponse {
  sessionId: string;
  callConnectionId: string;
  agent: CompanyAgentRole;
  displayName: string;
}

export interface TeamsLeaveRequest {
  sessionId: string;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL BRIDGE
// ═══════════════════════════════════════════════════════════════════

export interface VoiceToolDeclaration {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

// ═══════════════════════════════════════════════════════════════════
// COST TRACKING
// ═══════════════════════════════════════════════════════════════════

export interface VoiceUsageRecord {
  sessionId: string;
  agentRole: CompanyAgentRole;
  mode: VoiceSessionMode;
  durationSec: number;
  estimatedCost: number;
  userId: string;
  startedAt: string;
  endedAt: string;
}

export interface VoiceUsageSummary {
  totalMinutes: number;
  totalCost: number;
  byAgent: Record<string, { minutes: number; cost: number }>;
}

// ═══════════════════════════════════════════════════════════════════
// VOICE LIMITS
// ═══════════════════════════════════════════════════════════════════

export const VOICE_LIMITS = {
  maxSessionDurationSec: 30 * 60,   // 30 minutes per session
  maxDailyMinutes: 120,              // 2 hours total per day
  warnAtMinutes: 20,                 // warn user at 20 minutes
  autoEndAtMinutes: 30,              // auto-disconnect at 30 min

  // OpenAI Realtime pricing (per minute)
  audioInputPerMin: 0.06,
  audioOutputPerMin: 0.24,
} as const;

// ═══════════════════════════════════════════════════════════════════
// TRANSCRIPT EVENT
// ═══════════════════════════════════════════════════════════════════

export interface TranscriptEntry {
  sessionId: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}
