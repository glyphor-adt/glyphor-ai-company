/**
 * Workflow Orchestrator — Core state machine for multi-step agent workflows.
 *
 * Manages workflow lifecycle: start → advance → complete/fail/cancel.
 * Dispatches steps via Cloud Tasks when available, falls back to logging.
 * Handles retries with exponential backoff, parallel sub-step tracking,
 * and waiting-state resolution (approvals, delays, dependencies).
 */

import { systemQuery } from '@glyphor/shared/db';
import type {
  WorkflowDefinition,
  WorkflowState,
  StepResult,
  StepStatus,
  StepType,
  WorkflowStatus,
} from './workflowTypes.js';

// ─── Constants ──────────────────────────────────────────────────

const RETRY_BACKOFF_SECONDS = [30, 60, 120];
const MAX_WAIT_HOURS = 48;

// ─── Class ──────────────────────────────────────────────────────

export class WorkflowOrchestrator {
  constructor(
    private cloudTasksQueue?: {
      enqueue(payload: Record<string, unknown>): Promise<void>;
    },
  ) {}

  /**
   * Start a new workflow from a definition.
   * Inserts workflow + step rows, dispatches step 0.
   */
  async startWorkflow(definition: WorkflowDefinition): Promise<string> {
    try {
      const [workflow] = await systemQuery<{ id: string }>(
        `INSERT INTO workflows (type, initiator_role, directive_id, context, status)
         VALUES ($1, $2, $3, $4, 'running')
         RETURNING id`,
        [
          definition.type,
          definition.initiator_role,
          definition.directive_id ?? null,
          JSON.stringify(definition.initial_context),
        ],
      );

      const workflowId = workflow.id;

      // Insert all step definitions
      for (let i = 0; i < definition.steps.length; i++) {
        const step = definition.steps[i];
        await systemQuery(
          `INSERT INTO workflow_steps (workflow_id, step_index, step_type, step_config, on_failure, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [
            workflowId,
            i,
            step.step_type,
            JSON.stringify(step.step_config),
            step.on_failure ?? 'abort',
          ],
        );
      }

      // Dispatch first step
      await this.dispatchStep(workflowId, 0, definition.steps[0], definition.initial_context);

      await systemQuery(
        `UPDATE workflow_steps SET status = 'running', started_at = NOW()
         WHERE workflow_id = $1 AND step_index = 0`,
        [workflowId],
      );

      return workflowId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to start workflow: ${msg}`);
    }
  }

  /**
   * Advance a workflow after a step completes successfully.
   * Merges output into context and dispatches the next step.
   */
  async advanceWorkflow(
    workflowId: string,
    stepIndex: number,
    result: StepResult,
  ): Promise<void> {
    try {
      // Mark current step completed
      await systemQuery(
        `UPDATE workflow_steps
         SET status = 'completed', output = $1, completed_at = NOW()
         WHERE workflow_id = $2 AND step_index = $3`,
        [JSON.stringify(result.output), workflowId, stepIndex],
      );

      // Merge output into workflow context
      const [wf] = await systemQuery<{ context: Record<string, unknown>; id: string }>(
        `SELECT context FROM workflows WHERE id = $1`,
        [workflowId],
      );
      const context: Record<string, unknown> =
        typeof wf.context === 'string' ? JSON.parse(wf.context) : (wf.context ?? {});
      context[`step_${stepIndex}_output`] = result.output;
      if (result.cost_usd != null) {
        const prev = (context.total_cost_usd as number) ?? 0;
        context.total_cost_usd = prev + result.cost_usd;
      }

      await systemQuery(
        `UPDATE workflows SET context = $1, current_step_index = $2 WHERE id = $3`,
        [JSON.stringify(context), stepIndex + 1, workflowId],
      );

      // Determine next step
      const steps = await systemQuery<{
        step_index: number;
        step_type: StepType;
        step_config: Record<string, unknown>;
      }>(
        `SELECT step_index, step_type, step_config FROM workflow_steps
         WHERE workflow_id = $1 ORDER BY step_index`,
        [workflowId],
      );

      const nextIndex = stepIndex + 1;
      if (nextIndex >= steps.length) {
        // Workflow complete
        await systemQuery(
          `UPDATE workflows SET status = 'completed', completed_at = NOW() WHERE id = $1`,
          [workflowId],
        );
        return;
      }

      const next = steps[nextIndex];
      const stepConfig =
        typeof next.step_config === 'string'
          ? JSON.parse(next.step_config as unknown as string)
          : next.step_config;

      if (
        next.step_type === 'wait_approval' ||
        next.step_type === 'wait_webhook' ||
        next.step_type === 'wait_delay'
      ) {
        await systemQuery(
          `UPDATE workflows SET status = 'waiting', waiting_for = $1, wait_reference = $2 WHERE id = $3`,
          [next.step_type, (stepConfig.reference as string) ?? null, workflowId],
        );
        await systemQuery(
          `UPDATE workflow_steps SET status = 'waiting', started_at = NOW()
           WHERE workflow_id = $1 AND step_index = $2`,
          [workflowId, nextIndex],
        );
        return;
      }

      // Dispatch next step (agent_run, parallel_agents, evaluate, synthesize, enqueue_subtasks)
      await this.dispatchStep(workflowId, nextIndex, { step_type: next.step_type, step_config: stepConfig }, context);

      await systemQuery(
        `UPDATE workflow_steps SET status = 'running', started_at = NOW()
         WHERE workflow_id = $1 AND step_index = $2`,
        [workflowId, nextIndex],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowOrchestrator] advanceWorkflow failed: ${msg}`);
      throw err;
    }
  }

  /**
   * Handle a step failure. Retries with exponential backoff or applies on_failure policy.
   */
  async handleStepFailure(
    workflowId: string,
    stepIndex: number,
    error: string,
  ): Promise<void> {
    try {
      const [step] = await systemQuery<{
        retry_count: number;
        on_failure: string;
        step_type: StepType;
        step_config: Record<string, unknown>;
      }>(
        `SELECT retry_count, on_failure, step_type, step_config FROM workflow_steps
         WHERE workflow_id = $1 AND step_index = $2`,
        [workflowId, stepIndex],
      );

      const retryCount = step.retry_count ?? 0;
      const maxRetries = RETRY_BACKOFF_SECONDS.length;

      if (retryCount < maxRetries && (step.on_failure === 'retry' || step.on_failure === 'abort')) {
        // Retry with exponential backoff
        const delaySec = RETRY_BACKOFF_SECONDS[retryCount];
        await systemQuery(
          `UPDATE workflow_steps SET retry_count = $1, error = $2
           WHERE workflow_id = $3 AND step_index = $4`,
          [retryCount + 1, error, workflowId, stepIndex],
        );

        const [wf] = await systemQuery<{ context: Record<string, unknown> }>(
          `SELECT context FROM workflows WHERE id = $1`,
          [workflowId],
        );
        const context =
          typeof wf.context === 'string' ? JSON.parse(wf.context) : (wf.context ?? {});
        const stepConfig =
          typeof step.step_config === 'string'
            ? JSON.parse(step.step_config as unknown as string)
            : step.step_config;

        await this.dispatchStep(
          workflowId,
          stepIndex,
          { step_type: step.step_type, step_config: stepConfig },
          context,
          delaySec,
        );
        return;
      }

      // Retries exhausted — apply failure policy
      await systemQuery(
        `UPDATE workflow_steps SET status = 'failed', error = $1, completed_at = NOW()
         WHERE workflow_id = $2 AND step_index = $3`,
        [error, workflowId, stepIndex],
      );

      if (step.on_failure === 'skip') {
        // Skip and advance
        await this.advanceWorkflow(workflowId, stepIndex, { output: null, skipped: true });
      } else {
        // Abort workflow
        await systemQuery(
          `UPDATE workflows SET status = 'failed', completed_at = NOW() WHERE id = $1`,
          [workflowId],
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowOrchestrator] handleStepFailure failed: ${msg}`);
      await systemQuery(
        `UPDATE workflows SET status = 'failed', completed_at = NOW() WHERE id = $1`,
        [workflowId],
      ).catch(() => {});
    }
  }

  /**
   * Check waiting workflows and resume those whose conditions are met.
   * Returns count of resumed workflows.
   */
  async checkWaitingWorkflows(): Promise<number> {
    try {
      const waiting = await systemQuery<{
        id: string;
        waiting_for: string;
        wait_reference: string | null;
        current_step_index: number;
        created_at: string;
      }>(
        `SELECT id, waiting_for, wait_reference, current_step_index, created_at
         FROM workflows WHERE status = 'waiting'`,
      );

      let resumed = 0;

      for (const wf of waiting) {
        const waitingHours =
          (Date.now() - new Date(wf.created_at).getTime()) / (1000 * 60 * 60);

        // Fail if waiting too long
        if (waitingHours > MAX_WAIT_HOURS) {
          await systemQuery(
            `UPDATE workflows SET status = 'failed', completed_at = NOW() WHERE id = $1`,
            [wf.id],
          );
          await systemQuery(
            `UPDATE workflow_steps SET status = 'failed', error = 'Wait timeout exceeded'
             WHERE workflow_id = $1 AND step_index = $2`,
            [wf.id, wf.current_step_index],
          );
          continue;
        }

        let conditionMet = false;

        if (wf.waiting_for === 'wait_approval' && wf.wait_reference) {
          const [decision] = await systemQuery<{ status: string }>(
            `SELECT status FROM decisions WHERE id = $1 LIMIT 1`,
            [wf.wait_reference],
          );
          conditionMet = decision?.status === 'approved';
        } else if (wf.waiting_for === 'wait_delay' && wf.wait_reference) {
          const targetTime = new Date(wf.wait_reference).getTime();
          conditionMet = Date.now() >= targetTime;
        } else if (wf.waiting_for === 'wait_webhook' && wf.wait_reference) {
          const [hook] = await systemQuery<{ received: boolean }>(
            `SELECT received FROM webhook_signals WHERE reference = $1 LIMIT 1`,
            [wf.wait_reference],
          );
          conditionMet = hook?.received === true;
        }

        if (conditionMet) {
          // Resume: mark wait step completed, advance
          await systemQuery(
            `UPDATE workflows SET status = 'running', waiting_for = NULL, wait_reference = NULL
             WHERE id = $1`,
            [wf.id],
          );
          await this.advanceWorkflow(wf.id, wf.current_step_index, {
            output: { resumed: true, waiting_for: wf.waiting_for },
          });
          resumed++;
        }
      }

      return resumed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowOrchestrator] checkWaitingWorkflows failed: ${msg}`);
      return 0;
    }
  }

  /**
   * Cancel a workflow and skip all pending/running steps.
   */
  async cancelWorkflow(workflowId: string, reason: string): Promise<void> {
    try {
      await systemQuery(
        `UPDATE workflows SET status = 'cancelled', completed_at = NOW() WHERE id = $1`,
        [workflowId],
      );

      await systemQuery(
        `UPDATE workflow_steps SET status = 'skipped', error = $1, completed_at = NOW()
         WHERE workflow_id = $2 AND status IN ('pending', 'running', 'waiting')`,
        [reason, workflowId],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowOrchestrator] cancelWorkflow failed: ${msg}`);
      throw err;
    }
  }

  /**
   * Get the full state of a workflow including all steps.
   */
  async getWorkflowState(workflowId: string): Promise<WorkflowState> {
    const [wf] = await systemQuery<{
      id: string;
      status: WorkflowStatus;
      current_step_index: number;
      context: Record<string, unknown>;
    }>(
      `SELECT id, status, current_step_index, context FROM workflows WHERE id = $1`,
      [workflowId],
    );

    if (!wf) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const steps = await systemQuery<{
      step_index: number;
      step_type: StepType;
      status: StepStatus;
      output: unknown;
      error: string | null;
    }>(
      `SELECT step_index, step_type, status, output, error FROM workflow_steps
       WHERE workflow_id = $1 ORDER BY step_index`,
      [workflowId],
    );

    const context =
      typeof wf.context === 'string' ? JSON.parse(wf.context) : (wf.context ?? {});

    return {
      id: wf.id,
      status: wf.status,
      current_step_index: wf.current_step_index ?? 0,
      context,
      steps: steps.map((s) => ({
        index: s.step_index,
        type: s.step_type,
        status: s.status,
        output: typeof s.output === 'string' ? JSON.parse(s.output) : s.output,
        error: s.error ?? undefined,
      })),
    };
  }

  /**
   * Record completion of a parallel sub-step.
   * When all sub-steps complete, advances the workflow.
   */
  async recordParallelSubCompletion(
    workflowId: string,
    stepIndex: number,
    subIndex: number,
    result: unknown,
  ): Promise<void> {
    try {
      const [step] = await systemQuery<{
        output: unknown;
        step_config: Record<string, unknown>;
      }>(
        `SELECT output, step_config FROM workflow_steps
         WHERE workflow_id = $1 AND step_index = $2`,
        [workflowId, stepIndex],
      );

      const existing = typeof step.output === 'string'
        ? JSON.parse(step.output)
        : (step.output ?? {});
      const subResults: Record<string, unknown> = existing.sub_results ?? {};
      subResults[String(subIndex)] = result;

      const stepConfig =
        typeof step.step_config === 'string'
          ? JSON.parse(step.step_config as unknown as string)
          : step.step_config;
      const totalSubs = (stepConfig.agents as unknown[])?.length ?? 0;
      const completedCount = Object.keys(subResults).length;

      const updatedOutput = { ...existing, sub_results: subResults, completed: completedCount, total: totalSubs };

      await systemQuery(
        `UPDATE workflow_steps SET output = $1 WHERE workflow_id = $2 AND step_index = $3`,
        [JSON.stringify(updatedOutput), workflowId, stepIndex],
      );

      if (completedCount >= totalSubs) {
        await this.advanceWorkflow(workflowId, stepIndex, {
          output: updatedOutput,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowOrchestrator] recordParallelSubCompletion failed: ${msg}`);
      throw err;
    }
  }

  // ─── Private ────────────────────────────────────────────────────

  /**
   * Dispatch a step for execution via Cloud Tasks or log fallback.
   */
  private async dispatchStep(
    workflowId: string,
    stepIndex: number,
    step: { step_type: StepType; step_config: Record<string, unknown> },
    context: Record<string, unknown>,
    delaySec?: number,
  ): Promise<void> {
    const payload = {
      workflowId,
      stepIndex,
      stepType: step.step_type,
      stepConfig: step.step_config,
      context,
      ...(delaySec ? { scheduleDelaySec: delaySec } : {}),
    };

    if (this.cloudTasksQueue) {
      await this.cloudTasksQueue.enqueue(payload);
    } else {
      console.log(
        `[WorkflowOrchestrator] No queue configured — step ${stepIndex} (${step.step_type}) for workflow ${workflowId} logged for manual dispatch`,
      );
    }
  }
}
