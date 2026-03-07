export type WorkflowType = 
  | 'directive_orchestration' | 'research_chain' | 'deep_dive' 
  | 'strategy_lab' | 'code_evolution' | 'approval_wait' | 'custom';

export type WorkflowStatus = 
  | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'paused';

export type StepType = 
  | 'agent_run' | 'parallel_agents' | 'wait_approval' | 'wait_webhook' 
  | 'wait_delay' | 'evaluate' | 'synthesize' | 'enqueue_subtasks';

export type StepStatus = 
  | 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';

export interface WorkflowDefinition {
  type: WorkflowType;
  initiator_role: string;
  directive_id?: string;
  initial_context: Record<string, unknown>;
  steps: StepDefinition[];
}

export interface StepDefinition {
  step_type: StepType;
  step_config: Record<string, unknown>;
  on_failure?: 'retry' | 'skip' | 'abort';
}

export interface StepResult {
  output: unknown;
  run_id?: string;
  cost_usd?: number;
  skipped?: boolean;
}

export interface WorkflowState {
  id: string;
  status: WorkflowStatus;
  current_step_index: number;
  context: Record<string, unknown>;
  steps: Array<{
    index: number;
    type: StepType;
    status: StepStatus;
    output?: unknown;
    error?: string;
  }>;
}
