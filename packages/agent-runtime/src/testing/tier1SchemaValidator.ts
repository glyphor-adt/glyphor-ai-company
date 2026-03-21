import { systemQuery as dbQuery } from '@glyphor/shared/db';
import { loadRegisteredTool, getAllKnownTools } from '../toolRegistry.js';

export interface SchemaValidationResult {
  toolName: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const ALLOWED_JSON_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
]);

function normalizeSchemaType(typeValue: unknown): string | null {
  if (typeof typeValue !== 'string') return null;
  return typeValue.trim().toLowerCase();
}

function validateParamType(paramName: string, rawType: unknown, errors: string[]): void {
  if (Array.isArray(rawType)) {
    if (rawType.length === 0) {
      errors.push(`Parameter '${paramName}' has an empty type array`);
      return;
    }

    for (const entry of rawType) {
      const normalized = normalizeSchemaType(entry);
      if (!normalized || !ALLOWED_JSON_SCHEMA_TYPES.has(normalized)) {
        errors.push(`Parameter '${paramName}' has invalid type entry: ${String(entry)}`);
      }
    }
    return;
  }

  const normalized = normalizeSchemaType(rawType);
  if (!normalized || !ALLOWED_JSON_SCHEMA_TYPES.has(normalized)) {
    errors.push(`Parameter '${paramName}' has invalid type: ${String(rawType)}`);
  }
}

export async function validateToolSchema(
  toolName: string
): Promise<SchemaValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const tool = await loadRegisteredTool(toolName);

    if (!tool) {
      // Not a dynamic tool, assume valid (static tools are TS checked)
      return { toolName, valid: true, errors: [], warnings: [] };
    }

    // Required fields
    if (!tool.name || tool.name !== toolName) {
      errors.push(`Name mismatch: registry has '${toolName}', tool returns '${tool.name}'`);
    }
    if (!tool.description || tool.description.trim().length < 10) {
      errors.push('Description missing or too short (<10 chars)');
    }
    if (!tool.parameters || typeof tool.parameters !== 'object') {
      errors.push('Parameters definition missing or not an object');
    }

    // Parameter validation
    if (tool.parameters) {
      const properties: any = (tool.parameters as any).properties || tool.parameters;
      for (const [paramName, param] of Object.entries(properties)) {
        const p = param as any;
        if (!p.type) {
          errors.push(`Parameter '${paramName}' missing type`);
          continue;
        }
        if (!p.description) warnings.push(`Parameter '${paramName}' missing description`);
        validateParamType(paramName, p.type, errors);
      }
    }

  } catch (err) {
    errors.push(`Tool threw during load: ${String(err)}`);
  }

  return { toolName, valid: errors.length === 0, errors, warnings };
}

export async function runTier1ForAllTools(testRunId: string): Promise<void> {
  const allTools = getAllKnownTools();
  const dynamicQuery = await dbQuery<{ name: string }>(
    `SELECT name FROM tool_registry WHERE is_active = true`
  );
  const allToolNames = [...new Set([...allTools, ...dynamicQuery.map(t => t.name)])];

  console.log(`Running Tier 1 schema validation for ${allToolNames.length} tools...`);

  // Run in batches of 50 — no rate limit concerns (no network calls)
  const batchSize = 50;
  for (let i = 0; i < allToolNames.length; i += batchSize) {
    const batch = allToolNames.slice(i, i + batchSize);
    await Promise.all(batch.map(async toolName => {
      const result = await validateToolSchema(toolName);
      await dbQuery(`
        INSERT INTO tool_test_results (
          test_run_id, tool_name, risk_tier, test_strategy, status,
          schema_valid, error_message, error_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        testRunId, 
        toolName,
        'any', 
        'schema_only',
        result.valid ? 'pass' : 'fail',
        result.valid,
        result.errors.join('; ') || null,
        result.errors.length > 0 ? 'schema' : null,
      ]);
    }));
  }
}
