export const RUNTIME_SOURCE_OF_TRUTH = Object.freeze({
  runtimeHistory: 'run_events',
  runtimeEnvelope: ['run_sessions', 'run_attempts'] as const,
  userTranscript: 'chat_messages',
  opsTelemetry: ['agent_runs', 'activity_log', 'tool_call_traces', 'agent_run_status'] as const,
  isolatedFlows: ['ora'] as const,
  ownership: {
    controlPlane: 'scheduler',
    executionPlane: 'worker',
  },
});

export type RuntimeSourceOfTruth = typeof RUNTIME_SOURCE_OF_TRUTH;
