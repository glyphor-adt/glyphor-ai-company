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
  'vp-sales':        'alloy',     // Rachel Kim — confident, persuasive
  'vp-customer-success': 'ballad',// James Turner — calm, supportive
  'ops':             'verse',     // Atlas Vega — steady, operational
  'vp-research':     'coral',     // Sophia Lin — articulate, precise
  // Sub-team: Engineering
  'platform-engineer': 'echo',    // Alex Park
  'quality-engineer':  'ash',     // Sam DeLuca
  'devops-engineer':   'marin',   // Jordan Hayes
  // Sub-team: Product
  'user-researcher':     'coral', // Priya Sharma
  'competitive-intel':   'sage',  // Daniel Ortiz
  // Sub-team: Finance
  'revenue-analyst':  'alloy',    // Anna Park
  'cost-analyst':     'verse',    // Omar Hassan
  // Sub-team: Marketing
  'content-creator':       'shimmer', // Tyler Reed
  'seo-analyst':           'cedar',   // Lisa Chen
  'social-media-manager':  'marin',   // Kai Johnson
  // Sub-team: Customer Success
  'onboarding-specialist': 'ballad',  // Emma Wright
  'support-triage':        'alloy',   // David Santos
  // Sub-team: Sales
  'account-research': 'ash',          // Nathan Cole
  // Sub-team: Design
  'ui-ux-designer':    'coral',       // Leo Vargas
  'frontend-engineer': 'sage',        // Ava Chen
  'design-critic':     'echo',        // Sofia Marchetti
  'template-architect':'verse',       // Ryan Park
  // IT / Admin
  'm365-admin':   'cedar',            // Riley Morgan
  'global-admin': 'ballad',           // Morgan Blake
  // Research team
  'competitive-research-analyst': 'marin',   // Lena Park
  'market-research-analyst':      'shimmer', // Daniel Okafor
  'technical-research-analyst':   'ash',     // Kai Nakamura
  'industry-research-analyst':    'cedar',   // Amara Diallo
};

/** Display names for agents (mirrors dashboard DISPLAY_NAME_MAP) */
const DISPLAY_NAMES: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen',
  cto: 'Marcus Reeves',
  cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor',
  cmo: 'Maya Brooks',
  'vp-customer-success': 'James Turner',
  'vp-sales': 'Rachel Kim',
  'vp-design': 'Mia Tanaka',
  ops: 'Atlas Vega',
  clo: 'Victoria Chase',
  'vp-research': 'Sophia Lin',
  'platform-engineer': 'Alex Park',
  'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes',
  'user-researcher': 'Priya Sharma',
  'competitive-intel': 'Daniel Ortiz',
  'revenue-analyst': 'Anna Park',
  'cost-analyst': 'Omar Hassan',
  'content-creator': 'Tyler Reed',
  'seo-analyst': 'Lisa Chen',
  'social-media-manager': 'Kai Johnson',
  'onboarding-specialist': 'Emma Wright',
  'support-triage': 'David Santos',
  'account-research': 'Nathan Cole',
  'ui-ux-designer': 'Leo Vargas',
  'frontend-engineer': 'Ava Chen',
  'design-critic': 'Sofia Marchetti',
  'template-architect': 'Ryan Park',
  'm365-admin': 'Riley Morgan',
  'global-admin': 'Morgan Blake',
  'competitive-research-analyst': 'Lena Park',
  'market-research-analyst': 'Daniel Okafor',
  'technical-research-analyst': 'Kai Nakamura',
  'industry-research-analyst': 'Amara Diallo',
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
  'vp-sales': 'VP of Sales',
  'vp-customer-success': 'VP of Customer Success',
  'vp-research': 'VP of Research & Intelligence',
  ops: 'Director of Operations & System Intelligence',
  'platform-engineer': 'Platform Engineer',
  'quality-engineer': 'Quality Engineer',
  'devops-engineer': 'DevOps Engineer',
  'user-researcher': 'User Researcher',
  'competitive-intel': 'Competitive Intelligence Analyst',
  'revenue-analyst': 'Revenue Analyst',
  'cost-analyst': 'Cost Analyst',
  'content-creator': 'Content Creator',
  'seo-analyst': 'SEO Analyst',
  'social-media-manager': 'Social Media Manager',
  'onboarding-specialist': 'Onboarding Specialist',
  'support-triage': 'Support Triage Specialist',
  'account-research': 'Account Research Analyst',
  'ui-ux-designer': 'UI/UX Designer',
  'frontend-engineer': 'Frontend Engineer',
  'design-critic': 'Design Critic',
  'template-architect': 'Template Architect',
  'm365-admin': 'Microsoft 365 Administrator',
  'global-admin': 'Global Administrator',
  'competitive-research-analyst': 'Competitive Research Analyst',
  'market-research-analyst': 'Market Research Analyst',
  'technical-research-analyst': 'Technical Research Analyst',
  'industry-research-analyst': 'Industry Research Analyst',
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
