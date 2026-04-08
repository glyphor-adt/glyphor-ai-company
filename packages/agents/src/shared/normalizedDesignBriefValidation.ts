/**
 * Handoff contract for normalize_design_brief output (v1).
 * Fails closed for autonomous pipelines: invalid shapes never pass as "success".
 */

const PRODUCT_TYPES = new Set(['marketing_page', 'web_application', 'fullstack_application']);

export interface ValidatedNormalizedDesignBrief {
  audience_persona: string;
  primary_conversion_action: string;
  emotional_target: string;
  one_sentence_memory: string;
  aesthetic_direction: string;
  product_type: 'marketing_page' | 'web_application' | 'fullstack_application';
  component_inventory: Array<{
    name: string;
    priority: number;
    interaction_intent: string;
    motion_intent: string;
  }>;
  asset_manifest: {
    images: Array<{ name: string; type: string; purpose: string; path_hint: string }>;
    videos: Array<{ name: string; type: string; purpose: string; path_hint: string }>;
  };
  quality_contract: {
    required_breakpoints: number[];
    required_checks: string[];
    max_iteration_rounds: number;
  };
  missing_fields: string[];
}

export function validateNormalizedDesignBriefPayload(
  data: unknown,
): { ok: true; value: ValidatedNormalizedDesignBrief } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['normalized brief must be a non-null object'] };
  }
  const o = data as Record<string, unknown>;

  const reqStr = (key: string, maxLen = 20_000) => {
    const v = o[key];
    if (typeof v !== 'string' || !v.trim()) {
      errors.push(`${key} must be a non-empty string`);
      return '';
    }
    const t = v.trim();
    if (t.length > maxLen) errors.push(`${key} exceeds max length ${maxLen}`);
    return t;
  };

  const audience_persona = reqStr('audience_persona');
  const primary_conversion_action = reqStr('primary_conversion_action');
  const emotional_target = reqStr('emotional_target');
  const one_sentence_memory = reqStr('one_sentence_memory');
  const aesthetic_direction = reqStr('aesthetic_direction');

  const productTypeRaw = o.product_type;
  if (typeof productTypeRaw !== 'string' || !PRODUCT_TYPES.has(productTypeRaw)) {
    errors.push('product_type must be marketing_page | web_application | fullstack_application');
  }

  const ci = o.component_inventory;
  if (!Array.isArray(ci) || ci.length === 0) {
    errors.push('component_inventory must be a non-empty array');
  } else {
    for (let i = 0; i < ci.length; i++) {
      const row = ci[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(`component_inventory[${i}] must be an object`);
        continue;
      }
      const c = row as Record<string, unknown>;
      if (typeof c.name !== 'string' || !c.name.trim()) errors.push(`component_inventory[${i}].name required`);
      if (typeof c.priority !== 'number' || !Number.isFinite(c.priority)) {
        errors.push(`component_inventory[${i}].priority must be a number`);
      }
      if (typeof c.interaction_intent !== 'string' || !c.interaction_intent.trim()) {
        errors.push(`component_inventory[${i}].interaction_intent required`);
      }
      if (typeof c.motion_intent !== 'string' || !c.motion_intent.trim()) {
        errors.push(`component_inventory[${i}].motion_intent required`);
      }
    }
  }

  const am = o.asset_manifest;
  if (!am || typeof am !== 'object' || Array.isArray(am)) {
    errors.push('asset_manifest must be an object');
  } else {
    const amo = am as Record<string, unknown>;
    if (!Array.isArray(amo.images)) errors.push('asset_manifest.images must be an array');
    if (!Array.isArray(amo.videos)) errors.push('asset_manifest.videos must be an array');
  }

  const qc = o.quality_contract;
  if (!qc || typeof qc !== 'object' || Array.isArray(qc)) {
    errors.push('quality_contract must be an object');
  } else {
    const q = qc as Record<string, unknown>;
    if (!Array.isArray(q.required_breakpoints)) errors.push('quality_contract.required_breakpoints must be an array');
    if (!Array.isArray(q.required_checks)) errors.push('quality_contract.required_checks must be an array');
    if (typeof q.max_iteration_rounds !== 'number' || !Number.isFinite(q.max_iteration_rounds)) {
      errors.push('quality_contract.max_iteration_rounds must be a number');
    }
  }

  const mf = o.missing_fields;
  if (!Array.isArray(mf) || !mf.every((x) => typeof x === 'string')) {
    errors.push('missing_fields must be an array of strings');
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: ValidatedNormalizedDesignBrief = {
    audience_persona,
    primary_conversion_action,
    emotional_target,
    one_sentence_memory,
    aesthetic_direction,
    product_type: productTypeRaw as ValidatedNormalizedDesignBrief['product_type'],
    component_inventory: ci as ValidatedNormalizedDesignBrief['component_inventory'],
    asset_manifest: am as ValidatedNormalizedDesignBrief['asset_manifest'],
    quality_contract: qc as ValidatedNormalizedDesignBrief['quality_contract'],
    missing_fields: mf as string[],
  };

  return { ok: true, value };
}
