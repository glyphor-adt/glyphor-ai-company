/**
 * Agent Voice Mapping — Assigns a distinct OpenAI Realtime voice to each agent
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import type { AgentVoiceConfig, RealtimeVoice } from './types.js';

/** Voice assignment for every agent role */
export const AGENT_VOICES: Record<string, RealtimeVoice> = {
  'chief-of-staff':  'marin',     // Sarah Chen — warm, professional
  'cto':             'ash',       // Marcus Reeves — deep, technical
  'cfo':             'coral',     // Nadia Okafor — precise, measured
  'cpo':             'sage',      // Elena Vasquez — thoughtful, analytical
  'cmo':             'shimmer',   // Maya Brooks — energetic, creative
  'clo':             'echo',      // Victoria Chase — authoritative, calm
  'vp-design':       'cedar',     // Mia Tanaka — expressive, artistic
  'ops':             'verse',     // Atlas Vega — steady, operational
  'vp-research':     'coral',     // Sophia Lin — articulate, precise
  // Sub-team: Engineering
  'platform-engineer': 'echo',    // Alex Park
  'quality-engineer':  'ash',     // Sam DeLuca
  'devops-engineer':   'marin',   // Jordan Hayes
  // Sub-team: Product
  // Sub-team: Finance
  // Sub-team: Marketing
  // Sub-team: Sales
  // Sub-team: Design
  // IT / Admin
  // Research team
};

/** Display names for agents (mirrors dashboard DISPLAY_NAME_MAP) */
const DISPLAY_NAMES: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen',
  cto: 'Marcus Reeves',
  cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor',
  cmo: 'Maya Brooks',
  'vp-design': 'Mia Tanaka',
  ops: 'Atlas Vega',
  clo: 'Victoria Chase',
  'vp-research': 'Sophia Lin',
  'platform-engineer': 'Alex Park',
  'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes',
};
/** Title map for voice prompts */
const TITLE_MAP: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'Chief Technology Officer',
  cpo: 'Chief Product Officer',
  cfo: 'Chief Financial Officer',
  cmo: 'Chief Marketing Officer',
  clo: 'Chief Legal Officer',
  'vp-design': 'VP of Design',
  'vp-research': 'VP of Research & Intelligence',
  ops: 'Director of Operations & System Intelligence',
  'platform-engineer': 'Platform Engineer',
  'quality-engineer': 'Quality Engineer',
  'devops-engineer': 'DevOps Engineer',
};

export function getAgentVoiceConfig(role: CompanyAgentRole): AgentVoiceConfig {
  return {
    role,
    displayName: DISPLAY_NAMES[role] ?? role,
    voice: AGENT_VOICES[role] ?? 'alloy',
    title: TITLE_MAP[role] ?? role,
  };
}

export function getVoiceForAgent(role: string): RealtimeVoice {
  return AGENT_VOICES[role] ?? 'alloy';
}
