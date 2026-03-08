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
  getSelectableModels,
  getSelectableModelsByProvider,
  getVerifierModels,
  resolveModel,
  detectProvider,
  getFallbackChain,
  getVerifierFor,
  estimateModelCost,
  isDeprecated,
  getProviderLabel,
  optimizeModel,
  costPer1KOutput,
} from './models.js';
export type { ModelDef, ModelProvider, ModelTier, CostTier } from './models.js';

export {
  TRIANGULATION_MODELS,
  TRIANGULATION_TIMEOUTS,
} from './triangulation.js';
export type {
  QueryTier,
  ProviderScores,
  Divergence,
  TriangulationResult,
} from './triangulation.js';
