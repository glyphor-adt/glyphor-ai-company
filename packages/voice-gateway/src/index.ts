/**
 * Voice Gateway — Package Exports
 */

export { SessionManager } from './sessionManager.js';
export { DashboardVoiceHandler } from './dashboardHandler.js';
export { TeamsCallHandler } from './teamsHandler.js';
export { createRealtimeSession } from './realtimeClient.js';
export { toRealtimeTools, executeVoiceTool } from './toolBridge.js';
export { getAgentVoiceConfig, getVoiceForAgent, AGENT_VOICES } from './voiceMap.js';
export { buildVoiceSystemPrompt } from './voicePrompt.js';
export {
  VOICE_LIMITS,
  type AgentVoiceConfig,
  type RealtimeVoice,
  type VoiceSession,
  type VoiceSessionMode,
  type VoiceUsageRecord,
  type VoiceUsageSummary,
  type DashboardVoiceRequest,
  type DashboardVoiceResponse,
  type TeamsJoinRequest,
  type TeamsJoinResponse,
  type TeamsLeaveRequest,
  type VoiceToolDeclaration,
  type VoiceFunctionCall,
  type TranscriptEntry,
} from './types.js';
