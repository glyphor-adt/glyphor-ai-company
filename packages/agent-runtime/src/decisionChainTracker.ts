/**
 * Decision Chain Tracker — Creates a linked audit trail for every
 * directive showing the full path from instruction to outcome.
 *
 * Every step (assignment, execution, verification, formal check,
 * constitutional eval, authority gate, revision) becomes a chain link.
 * Enables compliance exports and counterfactual contribution analysis.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────

export type ChainLinkType =
  | 'directive_received'
  | 'assignment'
  | 'execution'
  | 'constitutional_eval'
  | 'verification'
  | 'formal_check'
  | 'authority_gate'
  | 'revision'
  | 'tool_call'
  | 'outcome';

export interface ChainLink {
  type: ChainLinkType;
  timestamp: string;
  agentRole?: string;
  [key: string]: unknown;
}

// ─── Class ──────────────────────────────────────────────────────

export class DecisionChainTracker {
  private chainId: string | null = null;
  private pendingLinks: ChainLink[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private supabase: SupabaseClient,
  ) {}

  /** Get the current chain ID (null if no chain started). */
  getChainId(): string | null {
    return this.chainId;
  }

  /**
   * Start a new decision chain for a directive or trigger.
   */
  async startChain(params: {
    directiveId?: string;
    triggerType: 'directive' | 'scheduled' | 'event_triggered' | 'manual';
    content: string;
    source: string;
  }): Promise<string> {
    const { data } = await this.supabase
      .from('decision_chains')
      .insert({
        directive_id: params.directiveId,
        trigger_type: params.triggerType,
        chain: [{
          type: 'directive_received',
          timestamp: new Date().toISOString(),
          content: params.content,
          source: params.source,
        }],
      })
      .select('id')
      .single();

    this.chainId = data?.id ?? null;
    return this.chainId!;
  }

  /**
   * Attach to an existing chain (for sub-agents joining mid-chain).
   */
  attachToChain(chainId: string): void {
    this.chainId = chainId;
  }

  /**
   * Add a link to the chain. Batches writes for efficiency.
   */
  addLink(link: Omit<ChainLink, 'timestamp'>): void {
    if (!this.chainId) return;

    this.pendingLinks.push({
      ...link,
      timestamp: new Date().toISOString(),
    });

    // Auto-flush every 5 seconds or when buffer hits 10
    if (this.pendingLinks.length >= 10) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), 5000);
    }
  }

  /**
   * Flush pending links to DB.
   */
  async flush(): Promise<void> {
    if (!this.chainId || this.pendingLinks.length === 0) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const linksToFlush = [...this.pendingLinks];
    this.pendingLinks = [];

    await this.supabase.rpc('append_chain_links', {
      p_chain_id: this.chainId,
      p_links: linksToFlush,
    });
  }

  /**
   * Complete the chain with final metrics.
   */
  async completeChain(params: {
    status: 'completed' | 'failed' | 'abandoned';
    totalCostUsd: number;
    totalDurationMs: number;
    outcomeSummary?: string;
    qualityScore?: number;
  }): Promise<void> {
    if (!this.chainId) return;

    if (params.outcomeSummary) {
      this.addLink({
        type: 'outcome',
        summary: params.outcomeSummary,
        qualityScore: params.qualityScore,
      });
    }
    await this.flush();

    await this.supabase
      .from('decision_chains')
      .update({
        status: params.status,
        total_cost_usd: params.totalCostUsd,
        total_duration_ms: params.totalDurationMs,
        completed_at: new Date().toISOString(),
      })
      .eq('id', this.chainId);
  }

  /**
   * Compute contribution scores after chain completes.
   */
  async computeContributions(): Promise<Record<string, number>> {
    if (!this.chainId) return {};

    const { data } = await this.supabase
      .from('decision_chains')
      .select('chain, total_cost_usd')
      .eq('id', this.chainId)
      .single();

    if (!data) return {};

    const agentContributions: Record<string, { cost: number; confidence: number; count: number }> = {};

    for (const link of data.chain as ChainLink[]) {
      if (link.type === 'execution' && link.agentRole) {
        const role = link.agentRole as string;
        if (!agentContributions[role]) {
          agentContributions[role] = { cost: 0, confidence: 0, count: 0 };
        }
        agentContributions[role].cost += (link.costUsd as number) ?? 0;
        agentContributions[role].confidence += (link.confidence as number) ?? 0.5;
        agentContributions[role].count += 1;
      }
    }

    const totalCost = Number(data.total_cost_usd) || 1;
    const contributions: Record<string, number> = {};

    for (const [role, stats] of Object.entries(agentContributions)) {
      const avgConfidence = stats.count > 0 ? stats.confidence / stats.count : 0.5;
      contributions[role] = (stats.cost / totalCost) * avgConfidence;
    }

    // Normalize to sum to 1
    const sum = Object.values(contributions).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (const role of Object.keys(contributions)) {
        contributions[role] /= sum;
      }
    }

    await this.supabase
      .from('decision_chains')
      .update({ contribution_scores: contributions })
      .eq('id', this.chainId);

    return contributions;
  }
}
