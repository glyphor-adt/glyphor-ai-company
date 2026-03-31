import { systemQuery } from '@glyphor/shared/db';
import { checkAgentPermission } from './abac.js';
import type { DataClassificationLevel } from './types.js';
import type { EmbeddingClient } from './jitContextRetriever.js';

const DEFAULT_LIMIT = 10;
const DEFAULT_MATCH_THRESHOLD = 0.6;
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

interface EntityConfigRow {
  entity_type: string;
  classification_level: DataClassificationLevel;
}

interface EntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  updated_by_agent_id: string;
}

interface EdgeRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  edge_type: string;
  properties: Record<string, unknown>;
  created_at: string;
  created_by_agent_id: string;
  from_entity_type?: string;
  to_entity_type?: string;
}

interface FactRow {
  id: string;
  entity_id: string;
  fact_key: string;
  fact_value: unknown;
  valid_from: string;
  valid_until: string | null;
  confidence: number | string;
  source_agent_id: string;
  source_type: string;
  created_at: string;
  entity_type?: string;
}

interface SemanticSearchRow extends EntityRow {
  similarity: number | string;
}

interface TraverseRow extends EntityRow {
  depth: number;
  path: string[];
  via_edge_type: string | null;
  parent_entity_id: string | null;
}

interface CountRow {
  count: number;
}

interface MostConnectedRow {
  id: string;
  name: string;
  entity_type: string;
  degree: number;
}

export interface TemporalKgEntity {
  id: string;
  entityType: string;
  entityId: string;
  name: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  updatedByAgentId: string;
}

export interface TemporalKgEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  edgeType: string;
  properties: Record<string, unknown>;
  createdAt: string;
  createdByAgentId: string;
}

export interface TemporalKgFact {
  id: string;
  entityId: string;
  factKey: string;
  factValue: unknown;
  validFrom: string;
  validUntil: string | null;
  confidence: number;
  sourceAgentId: string;
  sourceType: string;
  createdAt: string;
}

export interface TemporalKgSemanticResult extends TemporalKgEntity {
  similarity: number;
}

export interface TemporalKgTraversalNode extends TemporalKgEntity {
  depth: number;
  path: string[];
  viaEdgeType: string | null;
  parentEntityId: string | null;
}

export interface TemporalKgTraversalResult {
  startEntityId: string;
  nodes: TemporalKgTraversalNode[];
}

export interface TemporalKgEntityDetail {
  entity: TemporalKgEntity;
  currentFacts: TemporalKgFact[];
  outgoingEdges: TemporalKgEdge[];
  incomingEdges: TemporalKgEdge[];
}

export interface TemporalKgStats {
  entityCountByType: Record<string, number>;
  edgeCountByType: Record<string, number>;
  factCount: number;
  mostConnectedEntities: Array<{
    id: string;
    name: string;
    entityType: string;
    degree: number;
  }>;
}

export interface FilteredQueryOptions {
  entityTypes?: string[];
  queryType?: string;
  taskId?: string;
}

export class TemporalKnowledgeGraph {
  constructor(private embeddingClient: EmbeddingClient) {}

  async upsertEntity(
    entityType: string,
    entityId: string,
    name: string,
    properties: Record<string, unknown>,
    agentId: string,
  ): Promise<TemporalKgEntity> {
    const normalizedType = normalizeKey(entityType, 'entityType');
    const normalizedEntityId = requireText(entityId, 'entityId');
    const normalizedName = requireText(name, 'name');
    const canonicalAgentId = await resolveAgentIdentity(agentId);

    await this.assertEntityTypeConfigured(normalizedType);
    await ensureEntityTypeAccess(canonicalAgentId, normalizedType, undefined, 'upsert_entity');

    const embedding = await this.embeddingClient.embed(
      `${normalizedName}\n${JSON.stringify(properties ?? {})}`,
    );

    const [row] = await systemQuery<EntityRow>(
      `INSERT INTO kg_entities (
         tenant_id,
         entity_type,
         entity_id,
         name,
         properties,
         embedding,
         updated_by_agent_id,
         created_at,
         updated_at
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::vector,$7,NOW(),NOW())
       ON CONFLICT (tenant_id, entity_type, entity_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         properties = EXCLUDED.properties,
         embedding = EXCLUDED.embedding,
         updated_by_agent_id = EXCLUDED.updated_by_agent_id,
         updated_at = NOW()
       RETURNING *`,
      [
        DEFAULT_TENANT_ID,
        normalizedType,
        normalizedEntityId,
        normalizedName,
        JSON.stringify(properties ?? {}),
        toVectorLiteral(embedding),
        canonicalAgentId,
      ],
    );

    return mapEntityRow(row);
  }

  async addEdge(
    fromEntityId: string,
    toEntityId: string,
    edgeType: string,
    properties: Record<string, unknown>,
    agentId: string,
  ): Promise<TemporalKgEdge> {
    const canonicalAgentId = await resolveAgentIdentity(agentId);
    const normalizedEdgeType = normalizeKey(edgeType, 'edgeType');
    await this.assertEdgeTypeConfigured(normalizedEdgeType);

    const entities = await loadEntitiesByIds([fromEntityId, toEntityId]);
    const fromEntity = entities.get(fromEntityId);
    const toEntity = entities.get(toEntityId);
    if (!fromEntity || !toEntity) {
      throw new Error('Both fromEntityId and toEntityId must exist in kg_entities');
    }

    await ensureEntityTypeAccess(canonicalAgentId, fromEntity.entityType, undefined, 'add_edge');
    await ensureEntityTypeAccess(canonicalAgentId, toEntity.entityType, undefined, 'add_edge');

    const [row] = await systemQuery<EdgeRow>(
      `INSERT INTO kg_edges_temporal (
         tenant_id,
         from_entity_id,
         to_entity_id,
         edge_type,
         properties,
         created_by_agent_id,
         created_at
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW())
       ON CONFLICT (tenant_id, from_entity_id, to_entity_id, edge_type)
       DO UPDATE SET
         properties = EXCLUDED.properties,
         created_by_agent_id = EXCLUDED.created_by_agent_id
       RETURNING *`,
      [
        DEFAULT_TENANT_ID,
        fromEntityId,
        toEntityId,
        normalizedEdgeType,
        JSON.stringify(properties ?? {}),
        canonicalAgentId,
      ],
    );

    return mapEdgeRow(row);
  }

  async assertFact(
    entityId: string,
    factKey: string,
    factValue: unknown,
    agentId: string,
    sourceType: string,
    validFrom?: string | Date,
  ): Promise<TemporalKgFact> {
    const canonicalAgentId = await resolveAgentIdentity(agentId);
    const entity = await this.getEntityById(entityId);
    await ensureEntityTypeAccess(canonicalAgentId, entity.entityType, undefined, 'assert_fact');

    const effectiveValidFrom = validFrom instanceof Date
      ? validFrom.toISOString()
      : typeof validFrom === 'string' && validFrom.trim().length > 0
        ? new Date(validFrom).toISOString()
        : new Date().toISOString();

    const [row] = await systemQuery<FactRow>(
      `WITH closed AS (
         UPDATE kg_facts
         SET valid_until = $3::timestamptz
         WHERE tenant_id = $1
           AND entity_id = $2
           AND fact_key = $4
           AND valid_until IS NULL
       )
       INSERT INTO kg_facts (
         tenant_id,
         entity_id,
         fact_key,
         fact_value,
         valid_from,
         valid_until,
         confidence,
         source_agent_id,
         source_type,
         created_at
       )
       VALUES ($1,$2,$4,$5::jsonb,$3::timestamptz,NULL,$6,$7,$8,NOW())
       RETURNING *`,
      [
        DEFAULT_TENANT_ID,
        entityId,
        effectiveValidFrom,
        requireText(factKey, 'factKey'),
        JSON.stringify(factValue),
        1,
        canonicalAgentId,
        requireText(sourceType, 'sourceType'),
      ],
    );

    return mapFactRow(row);
  }

  async getCurrentFact(entityId: string, factKey: string): Promise<TemporalKgFact | null> {
    const rows = await systemQuery<FactRow>(
      `SELECT *
       FROM kg_facts
       WHERE tenant_id = $1
         AND entity_id = $2
         AND fact_key = $3
         AND valid_until IS NULL
       ORDER BY valid_from DESC
       LIMIT 1`,
      [DEFAULT_TENANT_ID, entityId, requireText(factKey, 'factKey')],
    );
    return rows[0] ? mapFactRow(rows[0]) : null;
  }

  async getCurrentFacts(entityId: string): Promise<TemporalKgFact[]> {
    const rows = await systemQuery<FactRow>(
      `SELECT *
       FROM kg_facts
       WHERE tenant_id = $1
         AND entity_id = $2
         AND valid_until IS NULL
       ORDER BY fact_key ASC, valid_from DESC`,
      [DEFAULT_TENANT_ID, entityId],
    );
    return rows.map(mapFactRow);
  }

  async getFactAt(entityId: string, factKey: string, timestamp: string | Date): Promise<TemporalKgFact | null> {
    const effectiveTimestamp = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
    const rows = await systemQuery<FactRow>(
      `SELECT *
       FROM kg_facts
       WHERE tenant_id = $1
         AND entity_id = $2
         AND fact_key = $3
         AND valid_from <= $4::timestamptz
         AND (valid_until IS NULL OR valid_until > $4::timestamptz)
       ORDER BY valid_from DESC
       LIMIT 1`,
      [DEFAULT_TENANT_ID, entityId, requireText(factKey, 'factKey'), effectiveTimestamp],
    );
    return rows[0] ? mapFactRow(rows[0]) : null;
  }

  async getEntityHistory(entityId: string): Promise<TemporalKgFact[]> {
    const rows = await systemQuery<FactRow>(
      `SELECT *
       FROM kg_facts
       WHERE tenant_id = $1
         AND entity_id = $2
       ORDER BY valid_from ASC, created_at ASC`,
      [DEFAULT_TENANT_ID, entityId],
    );
    return rows.map(mapFactRow);
  }

  async traverseGraph(
    startEntityId: string,
    edgeTypes: string[] = [],
    maxDepth = 2,
    agentId = 'system',
  ): Promise<TemporalKgTraversalResult> {
    const canonicalAgentId = await resolveAgentIdentity(agentId);
    const startEntity = await this.getEntityById(startEntityId);

    const rows = await filteredQuery(canonicalAgentId, async () => {
      const normalizedEdgeTypes = edgeTypes.map((edgeType) => normalizeKey(edgeType, 'edgeTypes'));
      const edgeFilterSql = normalizedEdgeTypes.length > 0
        ? 'AND e.edge_type = ANY($4::text[])'
        : '';
      const params: unknown[] = [DEFAULT_TENANT_ID, startEntityId, Math.max(1, Math.min(6, maxDepth))];
      if (normalizedEdgeTypes.length > 0) {
        params.push(normalizedEdgeTypes);
      }

      return systemQuery<TraverseRow>(
        `WITH RECURSIVE walk AS (
           SELECT
             e.id,
             e.entity_type,
             e.entity_id,
             e.name,
             e.properties,
             e.created_at,
             e.updated_at,
             e.updated_by_agent_id,
             0 AS depth,
             ARRAY[e.id::text] AS path,
             NULL::text AS via_edge_type,
             NULL::uuid AS parent_entity_id
           FROM kg_entities e
           WHERE e.tenant_id = $1
             AND e.id = $2

           UNION ALL

           SELECT
             next_entity.id,
             next_entity.entity_type,
             next_entity.entity_id,
             next_entity.name,
             next_entity.properties,
             next_entity.created_at,
             next_entity.updated_at,
             next_entity.updated_by_agent_id,
             walk.depth + 1,
             walk.path || next_entity.id::text,
             e.edge_type,
             walk.id AS parent_entity_id
           FROM walk
           JOIN kg_edges_temporal e
             ON e.tenant_id = $1
            AND (e.from_entity_id = walk.id OR e.to_entity_id = walk.id)
            ${edgeFilterSql}
           JOIN kg_entities next_entity
             ON next_entity.tenant_id = $1
            AND next_entity.id = CASE
              WHEN e.from_entity_id = walk.id THEN e.to_entity_id
              ELSE e.from_entity_id
            END
           WHERE walk.depth < $3
             AND NOT (next_entity.id::text = ANY(walk.path))
         )
         SELECT *
         FROM walk
         ORDER BY depth ASC, name ASC`,
        params,
      );
    }, {
      entityTypes: [startEntity.entityType],
      queryType: 'traverse_graph',
    });

    return {
      startEntityId,
      nodes: rows.map(mapTraverseRow),
    };
  }

  async semanticSearch(
    queryText: string,
    entityTypes?: string[],
    limit = DEFAULT_LIMIT,
    agentId = 'system',
  ): Promise<TemporalKgSemanticResult[]> {
    const embedding = await this.embeddingClient.embed(requireText(queryText, 'queryText'));
    const normalizedTypes = (entityTypes ?? []).map((value) => normalizeKey(value, 'entityTypes'));
    const effectiveAgentId = await resolveAgentIdentity(agentId);

    return filteredQuery(effectiveAgentId, async () => {
      const params: unknown[] = [DEFAULT_TENANT_ID, toVectorLiteral(embedding), Math.max(1, Math.min(50, limit)), DEFAULT_MATCH_THRESHOLD];
      let typeFilter = '';
      if (normalizedTypes.length > 0) {
        params.push(normalizedTypes);
        typeFilter = `AND e.entity_type = ANY($${params.length}::text[])`;
      }

      const rows = await systemQuery<SemanticSearchRow>(
        `SELECT
           e.*, 
           (1 - (e.embedding <=> $2::vector))::decimal AS similarity
         FROM kg_entities e
         WHERE e.tenant_id = $1
           AND e.embedding IS NOT NULL
           AND 1 - (e.embedding <=> $2::vector) > $4
           ${typeFilter}
         ORDER BY e.embedding <=> $2::vector
         LIMIT $3`,
        params,
      );
      return rows.map(mapSemanticRow);
    }, {
      entityTypes: normalizedTypes,
      queryType: 'semantic_search',
    });
  }

  async listEntities(
    filters: { entityType?: string; nameSearch?: string; limit?: number } = {},
    agentId = 'system',
  ): Promise<TemporalKgEntity[]> {
    const entityTypes = filters.entityType ? [normalizeKey(filters.entityType, 'entityType')] : undefined;
    const effectiveAgentId = await resolveAgentIdentity(agentId);
    return filteredQuery(effectiveAgentId, async () => {
      const values: unknown[] = [DEFAULT_TENANT_ID];
      const conditions = ['tenant_id = $1'];

      if (entityTypes && entityTypes.length > 0) {
        values.push(entityTypes[0]);
        conditions.push(`entity_type = $${values.length}`);
      }

      if (filters.nameSearch) {
        values.push(`%${filters.nameSearch.trim()}%`);
        conditions.push(`name ILIKE $${values.length}`);
      }

      values.push(Math.max(1, Math.min(200, filters.limit ?? 50)));
      const rows = await systemQuery<EntityRow>(
        `SELECT *
         FROM kg_entities
         WHERE ${conditions.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT $${values.length}`,
        values,
      );
      return rows.map(mapEntityRow);
    }, {
      entityTypes,
      queryType: 'list_entities',
    });
  }

  async getEntityDetail(entityId: string, agentId = 'system'): Promise<TemporalKgEntityDetail> {
    const effectiveAgentId = await resolveAgentIdentity(agentId);
    return filteredQuery(effectiveAgentId, async () => {
      const entity = await this.getEntityById(entityId);
      const [currentFacts, outgoingEdges, incomingEdges] = await Promise.all([
        this.getCurrentFacts(entityId),
        systemQuery<EdgeRow>(
          `SELECT *
           FROM kg_edges_temporal
           WHERE tenant_id = $1 AND from_entity_id = $2
           ORDER BY created_at DESC`,
          [DEFAULT_TENANT_ID, entityId],
        ),
        systemQuery<EdgeRow>(
          `SELECT *
           FROM kg_edges_temporal
           WHERE tenant_id = $1 AND to_entity_id = $2
           ORDER BY created_at DESC`,
          [DEFAULT_TENANT_ID, entityId],
        ),
      ]);

      return {
        entity,
        currentFacts,
        outgoingEdges: outgoingEdges.map(mapEdgeRow),
        incomingEdges: incomingEdges.map(mapEdgeRow),
      };
    }, {
      entityTypes: [(await this.getEntityById(entityId)).entityType],
      queryType: 'entity_detail',
    });
  }

  async getStats(agentId = 'system'): Promise<TemporalKgStats> {
    const effectiveAgentId = await resolveAgentIdentity(agentId);
    return filteredQuery(effectiveAgentId, async () => {
      const [entityCounts, edgeCounts, factCountRows, mostConnected] = await Promise.all([
        systemQuery<{ entity_type: string; count: number }>(
          `SELECT entity_type, COUNT(*)::int AS count
           FROM kg_entities
           WHERE tenant_id = $1
           GROUP BY entity_type
           ORDER BY entity_type ASC`,
          [DEFAULT_TENANT_ID],
        ),
        systemQuery<{ edge_type: string; count: number }>(
          `SELECT edge_type, COUNT(*)::int AS count
           FROM kg_edges_temporal
           WHERE tenant_id = $1
           GROUP BY edge_type
           ORDER BY edge_type ASC`,
          [DEFAULT_TENANT_ID],
        ),
        systemQuery<CountRow>(
          'SELECT COUNT(*)::int AS count FROM kg_facts WHERE tenant_id = $1',
          [DEFAULT_TENANT_ID],
        ),
        systemQuery<MostConnectedRow>(
          `SELECT
             e.id,
             e.name,
             e.entity_type,
             COUNT(et.id)::int AS degree
           FROM kg_entities e
           LEFT JOIN kg_edges_temporal et
             ON et.tenant_id = $1
            AND (et.from_entity_id = e.id OR et.to_entity_id = e.id)
           WHERE e.tenant_id = $1
           GROUP BY e.id, e.name, e.entity_type
           ORDER BY degree DESC, e.name ASC
           LIMIT 10`,
          [DEFAULT_TENANT_ID],
        ),
      ]);

      return {
        entityCountByType: Object.fromEntries(entityCounts.map((row) => [row.entity_type, row.count])),
        edgeCountByType: Object.fromEntries(edgeCounts.map((row) => [row.edge_type, row.count])),
        factCount: factCountRows[0]?.count ?? 0,
        mostConnectedEntities: mostConnected.map((row) => ({
          id: row.id,
          name: row.name,
          entityType: row.entity_type,
          degree: row.degree,
        })),
      };
    }, {
      queryType: 'kg_stats',
    });
  }

  async getEntityById(entityId: string): Promise<TemporalKgEntity> {
    const rows = await systemQuery<EntityRow>(
      'SELECT * FROM kg_entities WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [DEFAULT_TENANT_ID, entityId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`Temporal knowledge graph entity not found: ${entityId}`);
    }
    return mapEntityRow(row);
  }

  private async assertEntityTypeConfigured(entityType: string): Promise<void> {
    const rows = await systemQuery<EntityConfigRow>(
      `SELECT entity_type, classification_level
       FROM kg_entity_type_config
       WHERE tenant_id = $1
         AND entity_type = $2
         AND is_active = TRUE
       LIMIT 1`,
      [DEFAULT_TENANT_ID, entityType],
    );
    if (!rows[0]) {
      throw new Error(`Unknown or inactive temporal knowledge graph entity_type: ${entityType}`);
    }
  }

  private async assertEdgeTypeConfigured(edgeType: string): Promise<void> {
    const rows = await systemQuery<{ edge_type: string }>(
      `SELECT edge_type
       FROM kg_edge_type_config
       WHERE tenant_id = $1
         AND edge_type = $2
         AND is_active = TRUE
       LIMIT 1`,
      [DEFAULT_TENANT_ID, edgeType],
    );
    if (!rows[0]) {
      throw new Error(`Unknown or inactive temporal knowledge graph edge_type: ${edgeType}`);
    }
  }
}

export async function filteredQuery<T>(
  agentId: string,
  queryFn: () => Promise<T>,
  options: FilteredQueryOptions = {},
): Promise<T> {
  const canonicalAgentId = await resolveAgentIdentity(agentId);
  const queryType = options.queryType ?? 'query';
  if (canonicalAgentId === 'system') {
    const result = await queryFn();
    await logAccess(canonicalAgentId, queryType, extractEntityIds(result), options.taskId);
    return result;
  }
  const requestedEntityTypes = Array.from(new Set((options.entityTypes ?? []).map((value) => normalizeKey(value, 'entityTypes'))));
  const entityTypesToCheck = requestedEntityTypes.length > 0
    ? requestedEntityTypes
    : await listActiveEntityTypes();

  const allowedTypes = new Set<string>();
  if (entityTypesToCheck.length > 0) {
    for (const entityType of entityTypesToCheck) {
      const classificationLevel = await getEntityTypeClassification(entityType);
      const permission = await checkAgentPermission(
        canonicalAgentId,
        'temporal_knowledge_graph',
        entityType,
        classificationLevel,
        { taskId: options.taskId },
      );
      if (permission.allowed) {
        allowedTypes.add(entityType);
      }
    }
    if (allowedTypes.size === 0) {
      await logAccess(canonicalAgentId, queryType, [], options.taskId);
      return makeEmptyResult<T>(queryType);
    }
  }

  const result = await queryFn();
  const filteredResult = entityTypesToCheck.length > 0
    ? filterResultByEntityTypes(result, allowedTypes)
    : result;

  await logAccess(canonicalAgentId, queryType, extractEntityIds(filteredResult), options.taskId);
  return filteredResult;
}

async function ensureEntityTypeAccess(
  agentId: string,
  entityType: string,
  taskId?: string,
  queryType?: string,
): Promise<void> {
  if (agentId === 'system') return;
  const classificationLevel = await getEntityTypeClassification(entityType);
  const permission = await checkAgentPermission(
    agentId,
    'temporal_knowledge_graph',
    entityType,
    classificationLevel,
    { taskId },
  );
  if (!permission.allowed) {
    await logAccess(agentId, queryType ?? 'blocked', [], taskId);
    throw new Error(permission.reason);
  }
}

async function getEntityTypeClassification(entityType: string): Promise<DataClassificationLevel> {
  const rows = await systemQuery<EntityConfigRow>(
    `SELECT entity_type, classification_level
     FROM kg_entity_type_config
     WHERE tenant_id = $1
       AND entity_type = $2
       AND is_active = TRUE
     LIMIT 1`,
    [DEFAULT_TENANT_ID, entityType],
  );
  return rows[0]?.classification_level ?? 'restricted';
}

async function loadEntitiesByIds(entityIds: string[]): Promise<Map<string, TemporalKgEntity>> {
  if (entityIds.length === 0) return new Map();
  const rows = await systemQuery<EntityRow>(
    `SELECT *
     FROM kg_entities
     WHERE tenant_id = $1
       AND id = ANY($2::uuid[])`,
    [DEFAULT_TENANT_ID, entityIds],
  );
  return new Map(rows.map((row) => [row.id, mapEntityRow(row)]));
}

async function resolveAgentIdentity(agentId: string): Promise<string> {
  const normalized = requireText(agentId, 'agentId');
  const rows = await systemQuery<{ role: string }>(
    'SELECT role FROM company_agents WHERE id::text = $1 OR role = $1 LIMIT 1',
    [normalized],
  );
  return rows[0]?.role ?? normalized;
}

async function logAccess(
  agentId: string,
  queryType: string,
  entitiesAccessed: string[],
  taskId?: string,
): Promise<void> {
  await systemQuery(
    `INSERT INTO kg_access_log (tenant_id, agent_id, query_type, entities_accessed, task_id, timestamp)
     VALUES ($1,$2,$3,$4::jsonb,$5,NOW())`,
    [DEFAULT_TENANT_ID, agentId, queryType, JSON.stringify(entitiesAccessed), taskId ?? null],
  ).catch(() => {});
}

async function listActiveEntityTypes(): Promise<string[]> {
  const rows = await systemQuery<{ entity_type: string }>(
    `SELECT entity_type
     FROM kg_entity_type_config
     WHERE tenant_id = $1
       AND is_active = TRUE`,
    [DEFAULT_TENANT_ID],
  );
  return rows.map((row) => row.entity_type);
}

function mapEntityRow(row: EntityRow): TemporalKgEntity {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    name: row.name,
    properties: row.properties ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByAgentId: row.updated_by_agent_id,
  };
}

function mapEdgeRow(row: EdgeRow): TemporalKgEdge {
  return {
    id: row.id,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    edgeType: row.edge_type,
    properties: row.properties ?? {},
    createdAt: row.created_at,
    createdByAgentId: row.created_by_agent_id,
  };
}

function mapFactRow(row: FactRow): TemporalKgFact {
  return {
    id: row.id,
    entityId: row.entity_id,
    factKey: row.fact_key,
    factValue: row.fact_value,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    confidence: Number(row.confidence),
    sourceAgentId: row.source_agent_id,
    sourceType: row.source_type,
    createdAt: row.created_at,
  };
}

function mapSemanticRow(row: SemanticSearchRow): TemporalKgSemanticResult {
  return {
    ...mapEntityRow(row),
    similarity: Number(row.similarity),
  };
}

function mapTraverseRow(row: TraverseRow): TemporalKgTraversalNode {
  return {
    ...mapEntityRow(row),
    depth: row.depth,
    path: row.path,
    viaEdgeType: row.via_edge_type,
    parentEntityId: row.parent_entity_id,
  };
}

function normalizeKey(value: string, fieldName: string): string {
  return requireText(value, fieldName).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function requireText(value: string, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function filterResultByEntityTypes<T>(result: T, allowedTypes: Set<string>): T {
  if (Array.isArray(result)) {
    return result
      .map((item) => filterResultByEntityTypes(item, allowedTypes))
      .filter((item) => item !== undefined) as T;
  }

  if (!result || typeof result !== 'object') {
    return result;
  }

  const record = result as Record<string, unknown>;
  const entityType = typeof record.entityType === 'string'
    ? record.entityType
    : typeof record.entity_type === 'string'
      ? String(record.entity_type)
      : null;

  if (entityType && !allowedTypes.has(entityType)) {
    return undefined as T;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      next[key] = value
        .map((item) => filterResultByEntityTypes(item, allowedTypes))
        .filter((item) => item !== undefined);
      continue;
    }

    if (value && typeof value === 'object') {
      const filtered = filterResultByEntityTypes(value, allowedTypes);
      if (filtered !== undefined) {
        next[key] = filtered;
      }
      continue;
    }

    next[key] = value;
  }

  return next as T;
}

function extractEntityIds(result: unknown): string[] {
  const found = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    for (const key of ['id', 'entityId', 'entity_id', 'fromEntityId', 'toEntityId', 'from_entity_id', 'to_entity_id']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && /^[0-9a-f-]{36}$/i.test(candidate)) {
        found.add(candidate);
      }
    }

    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };

  visit(result);
  return [...found];
}

function makeEmptyResult<T>(queryType: string): T {
  switch (queryType) {
    case 'traverse_graph':
      return { startEntityId: '', nodes: [] } as T;
    case 'entity_detail':
      return {
        entity: undefined,
        currentFacts: [],
        outgoingEdges: [],
        incomingEdges: [],
      } as T;
    case 'kg_stats':
      return {
        entityCountByType: {},
        edgeCountByType: {},
        factCount: 0,
        mostConnectedEntities: [],
      } as T;
    default:
      return [] as T;
  }
}