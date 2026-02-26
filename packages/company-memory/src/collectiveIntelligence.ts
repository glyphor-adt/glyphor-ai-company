/**
 * Collective Intelligence — Organizational Cognition Layer
 *
 * Implements the three layers of collective intelligence:
 * Layer 1: Shared Situational Awareness (Company Pulse)
 * Layer 2: Knowledge Circulation (Routes, Inbox, Org Knowledge)
 * Layer 3: Organizational Learning (Process Patterns, Authority Proposals)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import type { EmbeddingClient } from './embeddingClient.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface CompanyPulse {
  mrr: number | null;
  mrr_change_pct: number | null;
  active_users: number | null;
  new_users_today: number | null;
  churn_events_today: number | null;
  platform_status: string;
  uptime_streak_days: number;
  active_incidents: number;
  avg_build_time_ms: number | null;
  decisions_pending: number;
  meetings_today: number;
  messages_today: number;
  highlights: PulseHighlight[];
  company_mood: string;
  updated_at: string;
}

export interface PulseHighlight {
  agent: string;
  type: 'positive' | 'alert' | 'neutral';
  text: string;
}

export interface CompanyKnowledgeEntry {
  id: string;
  knowledge_type: string;
  content: string;
  evidence: string | null;
  discovered_by: string | null;
  contributing_agents: string[];
  departments_affected: string[];
  agents_who_need_this: string[];
  confidence: number;
  times_validated: number;
  times_contradicted: number;
  status: string;
  tags: string[];
  created_at: string;
}

export interface KnowledgeRoute {
  id: string;
  source_agent: string | null;
  source_tags: string[];
  source_type: string | null;
  target_agents: string[];
  target_departments: string[];
  delivery_method: string;
  description: string | null;
  active: boolean;
}

export interface KnowledgeInboxItem {
  id: string;
  target_agent: string;
  knowledge_id: string | null;
  source_agent: string;
  content: string;
  status: string;
  created_at: string;
}

export interface ProcessPattern {
  id: string;
  pattern_type: string;
  description: string;
  evidence: string;
  frequency: number;
  impact_type: string | null;
  impact_magnitude: string | null;
  suggested_action: string | null;
  action_type: string | null;
  implemented: boolean;
  agents_involved: string[];
  departments_involved: string[];
  discovered_by: string;
  created_at: string;
}

export interface AuthorityProposal {
  id: string;
  agent_id: string;
  current_tier: string;
  proposed_tier: string;
  action: string;
  evidence: string;
  success_count: number | null;
  total_count: number | null;
  approval_rate: number | null;
  avg_wait_hours: number | null;
  negative_outcomes: number;
  status: string;
  proposed_by: string;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// COLLECTIVE INTELLIGENCE STORE
// ═══════════════════════════════════════════════════════════════════

export interface KnowledgeBaseSection {
  id: string;
  section: string;
  title: string;
  content: string;
  audience: string;
  last_edited_by: string;
  version: number;
  is_active: boolean;
  updated_at: string;
  created_at: string;
}

export interface FounderBulletin {
  id: string;
  created_by: string;
  content: string;
  audience: string;
  priority: string;
  active_from: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export class CollectiveIntelligenceStore {
  constructor(
    private supabase: SupabaseClient,
    private embeddingClient: EmbeddingClient | null = null,
  ) {}

  // ─── LAYER 0: COMPANY KNOWLEDGE BASE (DB-driven) ───────────

  /**
   * Load company knowledge base sections from the database,
   * filtered by audience (department). Replaces the static
   * COMPANY_KNOWLEDGE_BASE.md file reading.
   */
  async loadKnowledgeBase(department?: string): Promise<string> {
    const { data: sections, error } = await this.supabase
      .from('company_knowledge_base')
      .select('title, content')
      .or(`audience.eq.all${department ? `,audience.eq.${department}` : ''}`)
      .eq('is_active', true)
      .order('created_at');

    if (error || !sections?.length) return '';

    return sections
      .map((s: { title: string; content: string }) => `## ${s.title}\n\n${s.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Get all knowledge base sections (for dashboard editing).
   */
  async getKnowledgeBaseSections(): Promise<KnowledgeBaseSection[]> {
    const { data, error } = await this.supabase
      .from('company_knowledge_base')
      .select('*')
      .order('created_at');

    if (error) throw new Error(`Knowledge base query failed: ${error.message}`);
    return (data ?? []) as KnowledgeBaseSection[];
  }

  /**
   * Update a knowledge base section.
   */
  async updateKnowledgeBaseSection(id: string, updates: {
    title?: string;
    content?: string;
    audience?: string;
    is_active?: boolean;
    last_edited_by?: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('company_knowledge_base')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(`Knowledge base update failed: ${error.message}`);
  }

  // ─── FOUNDER BULLETINS ──────────────────────────────────────

  /**
   * Load active, non-expired founder bulletins for agent context injection.
   */
  async loadFounderBulletins(department?: string): Promise<string> {
    let query = this.supabase
      .from('founder_bulletins')
      .select('created_by, content, priority, created_at')
      .or(`audience.eq.all${department ? `,audience.eq.${department}` : ''}`)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data, error } = await query;
    if (error || !data?.length) return '';

    // Filter out expired bulletins client-side (simpler than complex SQL)
    const now = new Date().toISOString();
    const active = data.filter((b: any) => !b.expires_at || b.expires_at > now);
    if (!active.length) return '';

    const lines = active.map((b: any) => {
      const flag = b.priority === 'urgent' ? 'URGENT' : b.priority === 'important' ? 'IMPORTANT' : b.priority === 'fyi' ? 'FYI' : '';
      const ago = formatBulletinTime(b.created_at);
      return `${flag ? flag + ' — ' : ''}**${b.created_by}** (${ago}): ${b.content}`;
    });

    return `## Founder Bulletins\n\n${lines.join('\n\n')}`;
  }

  /**
   * Get all bulletins (for dashboard management).
   */
  async getFounderBulletins(includeInactive = false): Promise<FounderBulletin[]> {
    let query = this.supabase
      .from('founder_bulletins')
      .select('*')
      .order('created_at', { ascending: false });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Bulletins query failed: ${error.message}`);
    return (data ?? []) as FounderBulletin[];
  }

  /**
   * Create a new founder bulletin.
   */
  async createFounderBulletin(bulletin: {
    created_by: string;
    content: string;
    audience?: string;
    priority?: string;
    expires_at?: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase
      .from('founder_bulletins')
      .insert({
        created_by: bulletin.created_by,
        content: bulletin.content,
        audience: bulletin.audience ?? 'all',
        priority: bulletin.priority ?? 'normal',
        expires_at: bulletin.expires_at ?? null,
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`Bulletin creation failed: ${error?.message}`);
    return data.id;
  }

  /**
   * Deactivate a bulletin.
   */
  async deactivateBulletin(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('founder_bulletins')
      .update({ is_active: false })
      .eq('id', id);
    if (error) throw new Error(`Bulletin deactivation failed: ${error.message}`);
  }

  // ─── LAYER 1: COMPANY PULSE ─────────────────────────────────

  async getPulse(): Promise<CompanyPulse | null> {
    const { data } = await this.supabase
      .from('company_pulse')
      .select('*')
      .eq('id', 'current')
      .single();
    return data as CompanyPulse | null;
  }

  async updatePulse(updates: Partial<CompanyPulse>): Promise<void> {
    const { error } = await this.supabase
      .from('company_pulse')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', 'current');
    if (error) throw new Error(`Pulse update failed: ${error.message}`);
  }

  /**
   * Format company pulse as a concise context string for agent injection.
   */
  async formatPulseContext(): Promise<string> {
    const pulse = await this.getPulse();
    if (!pulse) return '';

    const mrrStr = pulse.mrr != null
      ? `$${pulse.mrr}${pulse.mrr_change_pct != null ? ` (${pulse.mrr_change_pct > 0 ? '+' : ''}${pulse.mrr_change_pct}%)` : ''}`
      : 'unknown';

    const highlights = (pulse.highlights ?? [])
      .map((h: PulseHighlight) =>
        `${h.type === 'alert' ? '[!]' : h.type === 'positive' ? '+' : '-'} ${h.text}`)
      .join('\n');

    return `## Company Pulse (as of ${pulse.updated_at})
MRR: ${mrrStr} · Users: ${pulse.active_users ?? '?'} · Platform: ${pulse.platform_status} · Uptime: Day ${pulse.uptime_streak_days} · Mood: ${pulse.company_mood}
Pending decisions: ${pulse.decisions_pending} · Incidents: ${pulse.active_incidents}
${highlights || '(no highlights)'}`;
  }

  // ─── LAYER 2: KNOWLEDGE CIRCULATION ─────────────────────────

  // --- Company Knowledge ---

  async saveCompanyKnowledge(entry: {
    knowledge_type: string;
    content: string;
    evidence?: string;
    discovered_by?: string;
    contributing_agents?: string[];
    discovery_context?: string;
    departments_affected?: string[];
    agents_who_need_this?: string[];
    confidence?: number;
    tags?: string[];
  }): Promise<string> {
    let embedding: number[] | null = null;
    if (this.embeddingClient) {
      try {
        embedding = await this.embeddingClient.embed(entry.content);
      } catch (err) {
        console.warn('[CI] Embedding failed for company knowledge:', (err as Error).message);
      }
    }

    const { data, error } = await this.supabase
      .from('company_knowledge')
      .insert({
        knowledge_type: entry.knowledge_type,
        content: entry.content,
        evidence: entry.evidence ?? null,
        discovered_by: entry.discovered_by ?? null,
        contributing_agents: entry.contributing_agents ?? [],
        discovery_context: entry.discovery_context ?? null,
        departments_affected: entry.departments_affected ?? [],
        agents_who_need_this: entry.agents_who_need_this ?? [],
        confidence: entry.confidence ?? 0.7,
        tags: entry.tags ?? [],
        ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`Company knowledge save failed: ${error?.message}`);
    return data.id;
  }

  async getCompanyKnowledge(options?: {
    agentId?: string;
    department?: string;
    limit?: number;
  }): Promise<CompanyKnowledgeEntry[]> {
    let query = this.supabase
      .from('company_knowledge')
      .select('*')
      .eq('status', 'active')
      .order('confidence', { ascending: false })
      .limit(options?.limit ?? 15);

    if (options?.agentId) {
      query = query.or(`agents_who_need_this.cs.{${options.agentId}},agents_who_need_this.eq.{}`);
    }
    if (options?.department) {
      query = query.or(`departments_affected.cs.{${options.department}},departments_affected.eq.{}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Company knowledge query failed: ${error.message}`);
    return (data ?? []) as CompanyKnowledgeEntry[];
  }

  /**
   * Format organizational knowledge as context for agent injection.
   */
  async formatOrgKnowledgeContext(agentId: string, department?: string): Promise<string> {
    const knowledge = await this.getCompanyKnowledge({ agentId, department, limit: 15 });
    if (!knowledge.length) return '';

    return `## What the Organization Knows (relevant to you)
${knowledge.map(k => `- [${k.knowledge_type}] ${k.content} (confidence: ${k.confidence})`).join('\n')}`;
  }

  // --- Knowledge Inbox ---

  async getKnowledgeInbox(agentId: string, limit = 10): Promise<KnowledgeInboxItem[]> {
    const { data, error } = await this.supabase
      .from('knowledge_inbox')
      .select('*')
      .eq('target_agent', agentId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Knowledge inbox query failed: ${error.message}`);
    return (data ?? []) as KnowledgeInboxItem[];
  }

  async consumeKnowledgeInbox(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase
      .from('knowledge_inbox')
      .update({ status: 'consumed' })
      .in('id', ids);
    if (error) console.warn('[CI] Failed to mark inbox items consumed:', error.message);
  }

  /**
   * Format knowledge inbox as context for agent injection.
   */
  async formatKnowledgeInboxContext(agentId: string): Promise<string> {
    const items = await this.getKnowledgeInbox(agentId);
    if (!items.length) return '';

    // Build context
    const lines = items.map(i => `- From ${i.source_agent}: ${i.content}`);

    // Mark as consumed
    await this.consumeKnowledgeInbox(items.map(i => i.id));

    return `## Knowledge From Your Colleagues
${lines.join('\n')}`;
  }

  // --- Knowledge Routes ---

  async getActiveRoutes(): Promise<KnowledgeRoute[]> {
    const { data, error } = await this.supabase
      .from('knowledge_routes')
      .select('*')
      .eq('active', true);

    if (error) throw new Error(`Knowledge routes query failed: ${error.message}`);
    return (data ?? []) as KnowledgeRoute[];
  }

  async createRoute(route: {
    source_agent?: string;
    source_tags?: string[];
    source_type?: string;
    target_agents?: string[];
    target_departments?: string[];
    delivery_method?: string;
    description?: string;
  }): Promise<string> {
    const { data, error } = await this.supabase
      .from('knowledge_routes')
      .insert({
        source_agent: route.source_agent ?? null,
        source_tags: route.source_tags ?? [],
        source_type: route.source_type ?? null,
        target_agents: route.target_agents ?? [],
        target_departments: route.target_departments ?? [],
        delivery_method: route.delivery_method ?? 'inject',
        description: route.description ?? null,
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`Route creation failed: ${error?.message}`);
    return data.id;
  }

  /**
   * Route new knowledge through matching routes.
   * Called after an agent generates knowledge during reflection.
   */
  async routeKnowledge(knowledge: {
    agent_id: string;
    content: string;
    tags: string[];
    knowledge_type?: string;
    knowledge_id?: string;
  }): Promise<number> {
    const routes = await this.getActiveRoutes();
    let routed = 0;

    for (const route of routes) {
      const tagMatch = route.source_tags.length > 0 &&
        route.source_tags.some(tag => knowledge.tags.includes(tag));
      const typeMatch = route.source_type != null &&
        route.source_type === knowledge.knowledge_type;
      const sourceMatch = route.source_agent == null ||
        route.source_agent === knowledge.agent_id;

      if ((tagMatch || typeMatch) && sourceMatch) {
        const targets = [
          ...route.target_agents,
        ].filter(id => id !== knowledge.agent_id); // don't route to self

        for (const target of targets) {
          if (route.delivery_method === 'alert' || route.delivery_method === 'message') {
            // Send as agent DM (urgent or normal)
            await this.supabase.from('agent_messages').insert({
              from_agent: knowledge.agent_id,
              to_agent: target,
              thread_id: crypto.randomUUID(),
              message: `${route.delivery_method === 'alert' ? '[ALERT] ' : ''}${knowledge.content}`,
              message_type: route.delivery_method === 'alert' ? 'alert' : 'info',
              priority: route.delivery_method === 'alert' ? 'urgent' : 'normal',
              status: 'pending',
            });
          } else {
            // Inject: write to knowledge inbox
            await this.supabase.from('knowledge_inbox').insert({
              target_agent: target,
              knowledge_id: knowledge.knowledge_id ?? null,
              source_agent: knowledge.agent_id,
              content: knowledge.content,
            });
          }
          routed++;
        }
      }
    }

    return routed;
  }

  // --- Contradiction Detection ---

  async detectContradictions(): Promise<{
    knowledge_a: { id: string; agent_role: string; content: string };
    knowledge_b: { id: string; agent_role: string; content: string; similarity: number };
  }[]> {
    if (!this.embeddingClient) return [];

    // Get recent active knowledge with embeddings
    const { data: allKnowledge } = await this.supabase
      .from('agent_memory')
      .select('id, agent_role, content, embedding, memory_type')
      .eq('memory_type', 'fact')
      .not('embedding', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!allKnowledge?.length) return [];

    const conflicts: {
      knowledge_a: { id: string; agent_role: string; content: string };
      knowledge_b: { id: string; agent_role: string; content: string; similarity: number };
    }[] = [];

    // Sample a subset to avoid O(n²) explosion
    const sample = allKnowledge.slice(0, 30);
    for (const k of sample) {
      const { data: similar } = await this.supabase.rpc('match_memories', {
        query_embedding: k.embedding,
        match_role: k.agent_role,
        match_threshold: 0.85,
        match_count: 5,
      });

      // Filter to knowledge from DIFFERENT agents
      const crossAgent = (similar ?? []).filter(
        (s: { id: string; agent_role: string }) =>
          s.agent_role !== k.agent_role && s.id !== k.id,
      );

      for (const ca of crossAgent) {
        conflicts.push({
          knowledge_a: { id: k.id, agent_role: k.agent_role, content: k.content },
          knowledge_b: { id: ca.id, agent_role: ca.agent_role, content: ca.content, similarity: ca.similarity },
        });
      }
    }

    return conflicts;
  }

  // ─── LAYER 3: ORGANIZATIONAL LEARNING ───────────────────────

  async saveProcessPattern(pattern: {
    pattern_type: string;
    description: string;
    evidence: string;
    frequency?: number;
    impact_type?: string;
    impact_magnitude?: string;
    suggested_action?: string;
    action_type?: string;
    agents_involved?: string[];
    departments_involved?: string[];
    discovered_by?: string;
  }): Promise<string> {
    const { data, error } = await this.supabase
      .from('process_patterns')
      .insert({
        pattern_type: pattern.pattern_type,
        description: pattern.description,
        evidence: pattern.evidence,
        frequency: pattern.frequency ?? 1,
        impact_type: pattern.impact_type ?? null,
        impact_magnitude: pattern.impact_magnitude ?? null,
        suggested_action: pattern.suggested_action ?? null,
        action_type: pattern.action_type ?? null,
        agents_involved: pattern.agents_involved ?? [],
        departments_involved: pattern.departments_involved ?? [],
        discovered_by: pattern.discovered_by ?? 'chief-of-staff',
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`Process pattern save failed: ${error?.message}`);
    return data.id;
  }

  async getProcessPatterns(options?: {
    implemented?: boolean;
    limit?: number;
  }): Promise<ProcessPattern[]> {
    let query = this.supabase
      .from('process_patterns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? 20);

    if (options?.implemented !== undefined) {
      query = query.eq('implemented', options.implemented);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Process pattern query failed: ${error.message}`);
    return (data ?? []) as ProcessPattern[];
  }

  async saveAuthorityProposal(proposal: {
    agent_id: string;
    current_tier: string;
    proposed_tier: string;
    action: string;
    evidence: string;
    success_count?: number;
    total_count?: number;
    approval_rate?: number;
    avg_wait_hours?: number;
    negative_outcomes?: number;
  }): Promise<string> {
    const { data, error } = await this.supabase
      .from('authority_proposals')
      .insert({
        agent_id: proposal.agent_id,
        current_tier: proposal.current_tier,
        proposed_tier: proposal.proposed_tier,
        action: proposal.action,
        evidence: proposal.evidence,
        success_count: proposal.success_count ?? null,
        total_count: proposal.total_count ?? null,
        approval_rate: proposal.approval_rate ?? null,
        avg_wait_hours: proposal.avg_wait_hours ?? null,
        negative_outcomes: proposal.negative_outcomes ?? 0,
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`Authority proposal save failed: ${error?.message}`);
    return data.id;
  }

  async getAuthorityProposals(status?: string): Promise<AuthorityProposal[]> {
    let query = this.supabase
      .from('authority_proposals')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new Error(`Authority proposal query failed: ${error.message}`);
    return (data ?? []) as AuthorityProposal[];
  }

  async resolveAuthorityProposal(id: string, status: 'approved' | 'rejected'): Promise<void> {
    const { error } = await this.supabase
      .from('authority_proposals')
      .update({ status })
      .eq('id', id);
    if (error) throw new Error(`Authority proposal resolution failed: ${error.message}`);
  }
}

function formatBulletinTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
