/**
 * Collective Intelligence — Organizational Cognition Layer
 *
 * Implements the three layers of collective intelligence:
 * Layer 1: Shared Situational Awareness (Company Vitals)
 * Layer 2: Knowledge Circulation (Routes, Inbox, Org Knowledge)
 * Layer 3: Organizational Learning (Process Patterns, Authority Proposals)
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import type { EmbeddingClient } from './embeddingClient.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface CompanyVitals {
  // Stored fields (writable by agents)
  mrr: number | null;
  mrr_change_pct: number | null;
  active_users: number | null;
  highlights: VitalsHighlight[];
  company_mood: string;
  updated_at: string;
  // Computed fields (live-queried, not stored)
  platform_status: string;
  active_incidents: number;
  decisions_pending: number;
}

export interface VitalsHighlight {
  agent: string;
  type: 'positive' | 'alert' | 'neutral';
  text: string;
}

/** @deprecated Use CompanyVitals instead */
export type CompanyPulse = CompanyVitals;
/** @deprecated Use VitalsHighlight instead */
export type PulseHighlight = VitalsHighlight;

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
    private embeddingClient: EmbeddingClient | null = null,
  ) {}

  // ─── LAYER 0: COMPANY KNOWLEDGE BASE (DB-driven) ───────────

  /**
   * Load company knowledge base sections from the database,
   * filtered by audience (department). Replaces the static
   * COMPANY_KNOWLEDGE_BASE.md file reading.
   */
  async loadKnowledgeBase(department?: string): Promise<string> {
    let sql = 'SELECT title, content FROM company_knowledge_base WHERE is_active = true AND (audience = $1';
    const params: any[] = ['all'];

    if (department) {
      params.push(department);
      sql += ` OR audience = $${params.length}`;
    }
    sql += ') ORDER BY created_at';

    const sections = await systemQuery<{ title: string; content: string }>(sql, params);

    if (!sections.length) return '';

    return sections
      .map((s) => `## ${s.title}\n\n${s.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Get all knowledge base sections (for dashboard editing).
   */
  async getKnowledgeBaseSections(): Promise<KnowledgeBaseSection[]> {
    const data = await systemQuery<KnowledgeBaseSection>(
      'SELECT * FROM company_knowledge_base ORDER BY created_at',
    );
    return data;
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
    const fields: string[] = ['updated_at = $2'];
    const params: any[] = [id, new Date().toISOString()];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        params.push(value);
        fields.push(`${key} = $${params.length}`);
      }
    }

    await systemQuery(
      `UPDATE company_knowledge_base SET ${fields.join(', ')} WHERE id = $1`,
      params,
    );
  }

  // ─── FOUNDER BULLETINS ──────────────────────────────────────

  /**
   * Load active, non-expired founder bulletins for agent context injection.
   */
  async loadFounderBulletins(department?: string): Promise<string> {
    let sql = 'SELECT created_by, content, priority, created_at, expires_at FROM founder_bulletins WHERE is_active = true AND (audience = $1';
    const params: any[] = ['all'];

    if (department) {
      params.push(department);
      sql += ` OR audience = $${params.length}`;
    }
    sql += ') ORDER BY created_at DESC LIMIT 10';

    const data = await systemQuery<any>(sql, params);
    if (!data.length) return '';

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
    let sql = 'SELECT * FROM founder_bulletins';
    const params: any[] = [];

    if (!includeInactive) {
      params.push(true);
      sql += ` WHERE is_active = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';

    const data = await systemQuery<FounderBulletin>(sql, params);
    return data;
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
    const [data] = await systemQuery<{ id: string }>(
      `INSERT INTO founder_bulletins (created_by, content, audience, priority, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [bulletin.created_by, bulletin.content, bulletin.audience ?? 'all', bulletin.priority ?? 'normal', bulletin.expires_at ?? null],
    );
    return data.id;
  }

  /**
   * Deactivate a bulletin.
   */
  async deactivateBulletin(id: string): Promise<void> {
    await systemQuery(
      'UPDATE founder_bulletins SET is_active = false WHERE id = $1',
      [id],
    );
  }

  // ─── LAYER 1: COMPANY VITALS ─────────────────────────────────

  async getVitals(): Promise<CompanyVitals | null> {
    // Fetch stored fields + compute live fields in parallel
    const [storedRows, incidentRows, decisionRows, statusRows] = await Promise.all([
      systemQuery<Record<string, unknown>>(
        "SELECT * FROM company_vitals WHERE id = 'current'",
      ),
      systemQuery<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM incidents WHERE resolved_at IS NULL",
      ),
      systemQuery<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM decisions WHERE status = 'pending'",
      ),
      systemQuery<{ status: string }>(
        "SELECT status FROM system_status ORDER BY created_at DESC LIMIT 1",
      ),
    ]);

    const stored = storedRows[0];
    if (!stored) return null;

    return {
      mrr: stored.mrr as number | null,
      mrr_change_pct: stored.mrr_change_pct as number | null,
      active_users: stored.active_users as number | null,
      highlights: (stored.highlights ?? []) as VitalsHighlight[],
      company_mood: (stored.company_mood as string) ?? 'steady',
      updated_at: (stored.updated_at as string) ?? new Date().toISOString(),
      // Computed live
      platform_status: (statusRows[0]?.status as string) ?? 'healthy',
      active_incidents: Number(incidentRows[0]?.count ?? 0),
      decisions_pending: Number(decisionRows[0]?.count ?? 0),
    };
  }

  /** @deprecated Use getVitals() */
  async getPulse(): Promise<CompanyVitals | null> {
    return this.getVitals();
  }

  async updateVitals(updates: Partial<CompanyVitals>): Promise<void> {
    // Filter out computed fields — they can't be written
    const { platform_status: _ps, active_incidents: _ai, decisions_pending: _dp, ...writableUpdates } = updates;
    const fields: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries({ ...writableUpdates, updated_at: new Date().toISOString() })) {
      params.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
      fields.push(`${key} = $${params.length}`);
    }

    if (fields.length === 0) return;

    await systemQuery(
      `UPDATE company_vitals SET ${fields.join(', ')} WHERE id = 'current'`,
      params,
    );
  }

  /** @deprecated Use updateVitals() */
  async updatePulse(updates: Partial<CompanyVitals>): Promise<void> {
    return this.updateVitals(updates);
  }

  /**
   * Format company vitals as a concise context string for agent injection.
   */
  async formatVitalsContext(): Promise<string> {
    const vitals = await this.getVitals();
    if (!vitals) return '';

    const mrrStr = vitals.mrr != null
      ? `$${vitals.mrr}${vitals.mrr_change_pct != null ? ` (${vitals.mrr_change_pct > 0 ? '+' : ''}${vitals.mrr_change_pct}%)` : ''}`
      : 'unknown';

    const highlights = (vitals.highlights ?? [])
      .map((h: VitalsHighlight) =>
        `${h.type === 'alert' ? '[!]' : h.type === 'positive' ? '+' : '-'} ${h.text}`)
      .join('\n');

    return `## Company Vitals (as of ${vitals.updated_at})
MRR: ${mrrStr} · Users: ${vitals.active_users ?? '?'} · Platform: ${vitals.platform_status} · Mood: ${vitals.company_mood}
Pending decisions: ${vitals.decisions_pending} · Incidents: ${vitals.active_incidents}
${highlights || '(no highlights)'}`;
  }

  /** @deprecated Use formatVitalsContext() */
  async formatPulseContext(): Promise<string> {
    return this.formatVitalsContext();
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

    const [data] = await systemQuery<{ id: string }>(
      `INSERT INTO company_knowledge (knowledge_type, content, evidence, discovered_by, contributing_agents, discovery_context, departments_affected, agents_who_need_this, confidence, tags${embedding ? ', embedding' : ''})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10${embedding ? ', $11' : ''}) RETURNING id`,
      [
        entry.knowledge_type, entry.content, entry.evidence ?? null, entry.discovered_by ?? null,
        entry.contributing_agents ?? [], entry.discovery_context ?? null,
        entry.departments_affected ?? [], entry.agents_who_need_this ?? [],
        entry.confidence ?? 0.7, entry.tags ?? [],
        ...(embedding ? [JSON.stringify(embedding)] : []),
      ],
    );
    return data.id;
  }

  async getCompanyKnowledge(options?: {
    agentId?: string;
    department?: string;
    limit?: number;
  }): Promise<CompanyKnowledgeEntry[]> {
    let sql = "SELECT * FROM company_knowledge WHERE status = 'active'";
    const params: any[] = [];

    if (options?.agentId) {
      params.push(`{${options.agentId}}`);
      sql += ` AND (agents_who_need_this @> $${params.length}::text[] OR agents_who_need_this = '{}')`;
    }
    if (options?.department) {
      params.push(`{${options.department}}`);
      sql += ` AND (departments_affected @> $${params.length}::text[] OR departments_affected = '{}')`;
    }

    params.push(options?.limit ?? 15);
    sql += ` ORDER BY confidence DESC LIMIT $${params.length}`;

    const data = await systemQuery<CompanyKnowledgeEntry>(sql, params);
    return data;
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
    const data = await systemQuery<KnowledgeInboxItem>(
      "SELECT * FROM knowledge_inbox WHERE target_agent = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT $2",
      [agentId, limit],
    );
    return data;
  }

  async consumeKnowledgeInbox(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await systemQuery(
        "UPDATE knowledge_inbox SET status = 'consumed' WHERE id = ANY($1)",
        [ids],
      );
    } catch (err) {
      console.warn('[CI] Failed to mark inbox items consumed:', (err as Error).message);
    }
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
    const data = await systemQuery<KnowledgeRoute>(
      'SELECT * FROM knowledge_routes WHERE active = true',
    );
    return data;
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
    const [data] = await systemQuery<{ id: string }>(
      `INSERT INTO knowledge_routes (source_agent, source_tags, source_type, target_agents, target_departments, delivery_method, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [route.source_agent ?? null, route.source_tags ?? [], route.source_type ?? null, route.target_agents ?? [], route.target_departments ?? [], route.delivery_method ?? 'inject', route.description ?? null],
    );
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
            await systemQuery(
              `INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [knowledge.agent_id, target, crypto.randomUUID(),
               `${route.delivery_method === 'alert' ? '[ALERT] ' : ''}${knowledge.content}`,
               route.delivery_method === 'alert' ? 'alert' : 'info',
               route.delivery_method === 'alert' ? 'urgent' : 'normal',
               'pending'],
            );
          } else {
            await systemQuery(
              `INSERT INTO knowledge_inbox (target_agent, knowledge_id, source_agent, content)
               VALUES ($1, $2, $3, $4)`,
              [target, knowledge.knowledge_id ?? null, knowledge.agent_id, knowledge.content],
            );
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
    const allKnowledge = await systemQuery<{
      id: string; agent_role: string; content: string; embedding: string; memory_type: string;
    }>(
      "SELECT id, agent_role, content, embedding, memory_type FROM agent_memory WHERE memory_type = 'fact' AND embedding IS NOT NULL ORDER BY created_at DESC LIMIT 100",
    );

    if (!allKnowledge.length) return [];

    const conflicts: {
      knowledge_a: { id: string; agent_role: string; content: string };
      knowledge_b: { id: string; agent_role: string; content: string; similarity: number };
    }[] = [];

    // Sample a subset to avoid O(n²) explosion
    const sample = allKnowledge.slice(0, 30);
    for (const k of sample) {
      const similar = await systemQuery<{
        id: string; agent_role: string; content: string; similarity: number;
      }>(
        'SELECT * FROM match_memories($1, $2, $3, $4)',
        [k.embedding, k.agent_role, 0.85, 5],
      );

      // Filter to knowledge from DIFFERENT agents
      const crossAgent = (similar).filter(
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
    const [data] = await systemQuery<{ id: string }>(
      `INSERT INTO process_patterns (pattern_type, description, evidence, frequency, impact_type, impact_magnitude, suggested_action, action_type, agents_involved, departments_involved, discovered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [pattern.pattern_type, pattern.description, pattern.evidence, pattern.frequency ?? 1, pattern.impact_type ?? null, pattern.impact_magnitude ?? null, pattern.suggested_action ?? null, pattern.action_type ?? null, pattern.agents_involved ?? [], pattern.departments_involved ?? [], pattern.discovered_by ?? 'chief-of-staff'],
    );
    return data.id;
  }

  async getProcessPatterns(options?: {
    implemented?: boolean;
    limit?: number;
  }): Promise<ProcessPattern[]> {
    let sql = 'SELECT * FROM process_patterns';
    const params: any[] = [];

    if (options?.implemented !== undefined) {
      params.push(options.implemented);
      sql += ` WHERE implemented = $${params.length}`;
    }

    params.push(options?.limit ?? 20);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const data = await systemQuery<ProcessPattern>(sql, params);
    return data;
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
    const [data] = await systemQuery<{ id: string }>(
      `INSERT INTO authority_proposals (agent_id, current_tier, proposed_tier, action, evidence, success_count, total_count, approval_rate, avg_wait_hours, negative_outcomes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [proposal.agent_id, proposal.current_tier, proposal.proposed_tier, proposal.action, proposal.evidence, proposal.success_count ?? null, proposal.total_count ?? null, proposal.approval_rate ?? null, proposal.avg_wait_hours ?? null, proposal.negative_outcomes ?? 0],
    );
    return data.id;
  }

  async getAuthorityProposals(status?: string): Promise<AuthorityProposal[]> {
    let sql = 'SELECT * FROM authority_proposals';
    const params: any[] = [];

    if (status) {
      params.push(status);
      sql += ` WHERE status = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';

    const data = await systemQuery<AuthorityProposal>(sql, params);
    return data;
  }

  async resolveAuthorityProposal(id: string, status: 'approved' | 'rejected'): Promise<void> {
    await systemQuery(
      'UPDATE authority_proposals SET status = $1 WHERE id = $2',
      [status, id],
    );
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
