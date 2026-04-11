export {
  tenantQuery,
  systemQuery,
  tenantTransaction,
  systemTransaction,
  insertReturning,
  updateById,
  checkDbHealth,
  closePool,
  pool,
} from './db.js';

export {
  getAgentCapacityConfig,
  upsertAgentCapacityConfig,
  enforceCapacityTier,
  logCommitment,
  approveCommitment,
  rejectCommitment,
  executeCommitment,
  reverseCommitment,
  listCommitments,
  getPendingCommitments,
} from './agentCapacity.js';
export type {
  CapacityTier,
  CommitmentRegistryStatus,
  AgentCapacityConfig,
  CapacityEnforcementAction,
  CapacityEnforcementResult,
  CommitmentRegistryEntry,
  CommitmentListFilters,
  CommitmentListResult,
  UpsertAgentCapacityInput,
} from './agentCapacity.js';

export { classifyActionRisk } from './actionRiskClassifier.js';
export type { ActionRiskLevel, ActionRiskAssessment } from './actionRiskClassifier.js';
export {
  CANONICAL_KEEP_ROSTER,
  CANONICAL_KEEP_ROSTER_SET,
  filterCanonicalKeepRoster,
  isCanonicalKeepRole,
} from './canonicalKeepRoster.js';
export type { CanonicalKeepRole } from './canonicalKeepRoster.js';

export {
  getAutonomyLevels,
  getAutonomyThresholds,
  getAgentAutonomyConfig,
  evaluateAutonomyLevel,
  listAutonomyOverview,
  getAutonomyHistory,
  getAutonomyAgentDetail,
  updateAgentAutonomyConfig,
  promoteAgentAutonomy,
  demoteAgentAutonomy,
  getAutonomyCohortBenchmarks,
  processDailyAutonomyAdjustments,
} from './agentAutonomy.js';
export {
  AUTONOMY_GATE_MIN_RUNS,
  AUTONOMY_GOLDEN_MIN_RESULTS,
  computeAutonomyCompositeScore,
  compositeCeilingAutonomyLevel,
  listGoldenEvalPassRatesByRole,
  loadRoleGoldenEvalPassRate,
  loadRolePlanningQuality,
} from './planningQualitySignals.js';
export type { GoldenEvalRoleRate, RolePlanningQualitySnapshot } from './planningQualitySignals.js';
export type {
  AutonomyChangeType,
  AutonomyLevelDefinition,
  AutonomyLevelThreshold,
  AgentAutonomyConfig,
  AutonomyEvaluationMetrics,
  AutonomyRequirementProgress,
  AutonomyThresholdProgress,
  AutonomyEvaluationResult,
  AutonomyHistoryEntry,
  AutonomyOverviewItem,
  AutonomyAgentDetail,
  UpdateAgentAutonomyConfigInput,
  ChangeAutonomyLevelInput,
  AutonomyOverviewFilters,
  AutonomyCohortBenchmark,
  DailyAutonomyAdjustment,
} from './agentAutonomy.js';

export {
  listDepartmentTemplates,
  listDepartmentsWithStatus,
  getDepartmentDetail,
  listActiveDepartments,
  pauseDepartment,
  getExpansionRecommendations,
  activateDepartment,
} from './departmentActivation.js';
export type {
  DepartmentRecord,
  AgentCatalogTemplate,
  DepartmentStats,
  DepartmentSummary,
  DepartmentDetail,
  ActivatedAgentRecord,
  ConnectedDepartmentRecord,
  ExpansionRecommendation,
  ActivateDepartmentConfig,
  ActivateDepartmentResult,
} from './departmentActivation.js';

export {
  captureDecisionTrace,
  queryDecisionTrace,
  getDecisionTraceById,
  getDecisionTraceByAuditLogId,
  updateDecisionTraceExplanation,
} from './decisionTraces.js';
export type {
  ReactIteration,
  SelfCritiqueOutput,
  T1SimulationResult,
  ValueAnalysisResult,
  AlternativeRejected,
  AbacDecisionTrace,
  AuditLogLink,
  LinkedContract,
  DecisionTraceEntry,
  DecisionTraceQueryFilters,
  DecisionTraceQueryResult,
  CaptureDecisionTraceInput,
} from './decisionTraces.js';

export { getAgentEconomicsOverview } from './agentEconomicsOverview.js';
export type {
  AgentEconomicsOverview,
  AgentEconomicsRollupRow,
  EconomicsWindowDays,
  FleetEconomicsSummary,
} from './agentEconomicsOverview.js';

export {
  computeAgentMetrics,
  computeFleetMetrics,
  getAgentMetricsWindows,
  listAgentMetrics,
  getExceptionLog,
  logReversal,
  listActionReversals,
  getReversalStats,
  getBenchmarkReport,
} from './agentMetrics.js';
export type {
  AgentMetricsSnapshot,
  FleetMetricsSnapshot,
  ExceptionLogFilters,
  ExceptionLogEntry,
  ExceptionLogResult,
  ActionReversalEntry,
  ReversalLogFilters,
  ReversalLogResult,
  ReversalStats,
  AgentMetricsWindows,
  BenchmarkReport,
  BenchmarkRoleCategoryMetric,
  BenchmarkAutonomyMetric,
  BenchmarkEscalationMetric,
} from './agentMetrics.js';

export {
  WORK_ASSIGNMENT_DEDUP_PREFIX_LEN,
  normalizeWorkAssignmentTaskPrefix,
  assertWorkAssignmentDispatchAllowed,
  assertBatchWorkAssignmentsDeduped,
} from './workAssignmentDuplicateGuard.js';

export type { Pool, PoolClient } from 'pg';

export {
  verifyToken,
  createCustomerUser,
  createSlackSession,
} from './auth.js';

export {
  uploadFile,
  getSignedUrl,
  downloadFile,
  deleteFile,
  uploadTenantFile,
} from './storage.js';

export {
  getSlackAgentIdentity,
  buildSlackAgentContextBlock,
  decorateSlackBlocks,
  type SlackAgentIdentity,
} from './slackIdentity.js';

export {
  SUPPORTED_MODELS,
  DEPRECATED_MODELS,
  DEFAULT_AGENT_MODEL,
  WEB_SEARCH_MODEL,
  REALTIME_MODEL,
  TRANSCRIPTION_MODEL,
  EMBEDDING_MODEL,
  IMAGE_MODEL,
  GRAPHRAG_MODEL,
  FALLBACK_CHAINS,
  VERIFIER_MAP,
  DEEP_DIVE_MODELS,
  DEEP_DIVE_VERIFICATION_MODELS,
  REASONING_VERIFICATION_MODELS,
  TIER_MODELS,
  EXEC_CHAT_MODEL,
  ROLE_COST_TIER,
  getModel,
  getBedrockInferenceId,
  getSelectableModels,
  getSelectableModelsByProvider,
  getVerifierModels,
  resolveModel,
  detectProvider,
  getFallbackChain,
  getProviderLocalFallbackChain,
  getVerifierFor,
  estimateModelCost,
  isDeprecated,
  getProviderLabel,
  getReasoningSupport,
  normalizeReasoningLevel,
  optimizeModel,
  costPer1KOutput,
  getContextWindow,
} from './models.js';
export type { ModelDef, ModelProvider, ModelTier, CostTier, ReasoningLevel, ReasoningSupport } from './models.js';

export {
  MODEL_CONFIG,
  getTierModel,
  getSpecialized,
  getFallback,
  isDisabled,
  ALL_ACTIVE_MODELS,
} from './models.config.js';
export type { ModelTier as ConfigModelTier, SpecializedPath } from './models.config.js';

export {
  DEFAULT_TRIANGULATION_MODEL_SELECTION,
  TRIANGULATION_MODELS,
  TRIANGULATION_TIMEOUTS,
} from './triangulation.js';
export type {
  QueryTier,
  ProviderScores,
  Divergence,
  TriangulationModelSelection,
  TriangulationResult,
} from './triangulation.js';

export {
  GCP_SECRET_NAME_GOOGLE_AI_API_KEY,
  getGoogleAiApiKey,
  googleAiMissingKeyMessage,
} from './googleAiEnv.js';

export type {
  GovernanceActionSeverity,
  GovernanceActionType,
  GovernanceAction,
  GovernanceChangeLogEventType,
  GovernanceChangeLogEvent,
  GovernanceTrendDirection,
  GovernanceIndicatorSeverity,
  GovernanceRiskIndicator,
  GovernanceTrustAlertSummary,
  GovernanceDriftAlertSummary,
  GovernanceAccessRiskSummary,
  GovernancePolicyHealthSummary,
  GovernanceComplianceSummary,
  GovernanceRiskSummary,
  GovernanceTrustColor,
  GovernanceTrustMapEntry,
  GovernanceLeastPrivilegeGrant,
  GovernanceLeastPrivilegeDepartment,
  GovernanceAccessIssueType,
  GovernanceAccessIssue,
  GovernanceAccessPosture,
  GovernancePolicyImpactCard,
  GovernanceComplianceHeatmapCell,
  GovernanceAmendmentProposal,
} from './governance.js';
