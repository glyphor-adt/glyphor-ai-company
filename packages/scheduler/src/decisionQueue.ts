/**
 * Decision Queue — Human approval workflow
 *
 * Manages decisions that require founder approval before execution.
 * Tracks decision state, notifies founders via Teams, and processes approvals.
 */

import type { CompanyDecision } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  sendTeamsWebhook,
  formatDecisionCard,
  TeamsBotHandler,
  buildChannelMap,
} from '@glyphor/integrations';

export interface PendingDecision extends CompanyDecision {
  notifiedAt?: string;
  remindedAt?: string;
  expiresAt?: string;
  approvals?: Record<string, { approved: boolean; comment?: string; at: string }>;
}

export class DecisionQueue {
  private readonly memory: CompanyMemoryStore;
  private readonly founderWebhooks: Record<string, string>;
  private readonly botHandler: TeamsBotHandler | null;
  private readonly channels: ReturnType<typeof buildChannelMap>;

  constructor(
    memory: CompanyMemoryStore,
    founderWebhooks: Record<string, string>,
    botHandler?: TeamsBotHandler | null,
  ) {
    this.memory = memory;
    this.founderWebhooks = founderWebhooks;
    this.channels = buildChannelMap();
    this.botHandler = botHandler ?? null;
  }

  /**
   * Submit a new decision for founder approval.
   */
  async submit(decision: CompanyDecision): Promise<void> {
    const id = await this.memory.createDecision(decision);

    // Notify relevant founders based on decision tier
    const targets = decision.tier === 'red'
      ? ['kristina', 'andrew']
      : decision.assignedTo.length > 0 ? decision.assignedTo : ['kristina', 'andrew'];

    const card = formatDecisionCard({
      id,
      tier: decision.tier,
      title: decision.title,
      summary: decision.summary,
      proposedBy: decision.proposedBy,
      reasoning: decision.reasoning ?? '',
      assignedTo: decision.assignedTo,
    });

    // Send via Bot Framework (preferred) or webhook fallback
    const decisionsChannel = this.channels.decisions;
    if (this.botHandler && decisionsChannel) {
      await this.botHandler.sendProactiveCardToChannel(decisionsChannel.teamId, decisionsChannel.channelId, card.attachments[0].content)
        .catch((err: unknown) => console.error('Failed to send decision via Bot Framework:', err));
    } else {
      const notifications = targets
        .filter((founder: string) => this.founderWebhooks[founder])
        .map((founder: string) =>
          sendTeamsWebhook(this.founderWebhooks[founder], card)
            .catch((err: unknown) => console.error(`Failed to notify ${founder}:`, err)),
        );
      await Promise.all(notifications);
    }

    await this.memory.write(
      `decision.pending.${id}`,
      JSON.stringify({
        ...decision,
        id,
        notifiedAt: new Date().toISOString(),
      }),
      decision.proposedBy,
    );
  }

  /**
   * Get all pending decisions, optionally filtered by agent role.
   */
  async getPending(agentRole?: string): Promise<CompanyDecision[]> {
    const decisions = await this.memory.getDecisions({ status: 'pending' });
    if (!agentRole) return decisions;
    return decisions.filter((d: CompanyDecision) => d.proposedBy === agentRole);
  }

  /**
   * Process a founder's approval or rejection.
   */
  async processResponse(
    decisionId: string,
    founder: string,
    approved: boolean,
    comment?: string,
  ): Promise<void> {
    const raw = await this.memory.read<string>(`decision.pending.${decisionId}`);
    if (!raw) {
      throw new Error(`Decision ${decisionId} not found in pending queue`);
    }

    const decision: PendingDecision = JSON.parse(raw);

    if (decision.tier === 'red') {
      // Red decisions need both founders
      const approvals = decision.approvals ?? {};
      approvals[founder] = { approved, comment, at: new Date().toISOString() };
      decision.approvals = approvals;

      const allFounders = ['kristina', 'andrew'];
      const allResponded = allFounders.every(f => approvals[f]);

      if (allResponded) {
        const allApproved = allFounders.every(f => approvals[f]?.approved);
        await this.finalize(decision, allApproved);
      } else {
        // Still waiting for the other founder
        await this.memory.write(
          `decision.pending.${decisionId}`,
          JSON.stringify(decision),
          'scheduler',
        );
      }
    } else {
      // Yellow decisions — single founder approval
      await this.finalize(decision, approved);
    }
  }

  /**
   * Finalize a decision — mark as approved/rejected and log it.
   */
  private async finalize(
    decision: PendingDecision,
    approved: boolean,
  ): Promise<void> {
    const status = approved ? 'approved' : 'rejected';

    // Update decision status via memory store
    await this.memory.write(
      `decision.resolved.${decision.id}`,
      JSON.stringify({
        ...decision,
        status,
        resolvedAt: new Date().toISOString(),
      }),
      'scheduler',
    );

    // Clean up pending entry
    await this.memory.write(`decision.pending.${decision.id}`, '', 'scheduler');

    // Log the resolution
    await this.memory.write(
      `activity.decision.${decision.id}`,
      JSON.stringify({
        type: 'decision_resolved',
        decisionId: decision.id,
        status,
        agentRole: decision.proposedBy,
        title: decision.title,
        at: new Date().toISOString(),
      }),
      'scheduler',
    );
  }

  /**
   * Send reminders for decisions pending longer than the threshold.
   */
  async sendReminders(maxAgeMs: number = 4 * 60 * 60 * 1000): Promise<void> {
    const pending = await this.getPending();
    const now = Date.now();

    for (const decision of pending) {
      const raw = await this.memory.read<string>(`decision.pending.${decision.id}`);
      if (!raw) continue;

      const pd: PendingDecision = JSON.parse(raw);
      const notifiedAt = pd.notifiedAt ? new Date(pd.notifiedAt).getTime() : 0;
      const remindedAt = pd.remindedAt ? new Date(pd.remindedAt).getTime() : 0;
      const lastContact = Math.max(notifiedAt, remindedAt);

      if (now - lastContact > maxAgeMs) {
        const targets = decision.tier === 'red'
          ? ['kristina', 'andrew']
          : decision.assignedTo.length > 0 ? decision.assignedTo : ['kristina', 'andrew'];

        const card = formatDecisionCard({
          id: decision.id,
          tier: decision.tier,
          title: `⏰ REMINDER: ${decision.title}`,
          summary: decision.summary,
          proposedBy: decision.proposedBy,
          reasoning: `This decision has been pending since ${pd.notifiedAt}`,
          assignedTo: decision.assignedTo,
        });

        // Send via Bot Framework (preferred) or webhook fallback
        const decisionsChannel = this.channels.decisions;
        if (this.botHandler && decisionsChannel) {
          await this.botHandler.sendProactiveCardToChannel(decisionsChannel.teamId, decisionsChannel.channelId, card.attachments[0].content)
            .catch((err: unknown) => console.error('Failed to send reminder via Bot Framework:', err));
        } else {
          for (const founder of targets) {
            const webhook = this.founderWebhooks[founder];
            if (webhook) {
              await sendTeamsWebhook(webhook, card).catch((err: unknown) =>
                console.error(`Reminder failed for ${founder}:`, err),
              );
            }
          }
        }

        pd.remindedAt = new Date().toISOString();
        await this.memory.write(
          `decision.pending.${decision.id}`,
          JSON.stringify(pd),
          'scheduler',
        );
      }
    }
  }
}
