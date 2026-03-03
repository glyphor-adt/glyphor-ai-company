/**
 * Model Pricing Validator
 *
 * Compares SUPPORTED_MODELS registry prices against known-good provider rates.
 * Run: npx tsx scripts/validate-model-pricing.ts
 *
 * After a provider changes prices, update REFERENCE_PRICES below with the new
 * values from the official pricing pages:
 *   - Google:    https://ai.google.dev/gemini-api/docs/pricing
 *   - OpenAI:    https://developers.openai.com/api/docs/pricing
 *   - Anthropic: https://platform.claude.com/docs/en/docs/about-claude/pricing
 *
 * Then run this script to see which registry entries are stale.
 */

import { SUPPORTED_MODELS, type ModelDef } from '../packages/shared/src/models.js';

// ──────────────────────────────────────────────────────────────
// Reference prices — manually verified against provider pages.
// Last verified: 2026-02-26
// ──────────────────────────────────────────────────────────────

interface ReferencePricing {
  inputPer1M: number;
  outputPer1M: number;
  thinkingPer1M?: number;
  cachedInputDiscount?: number;  // multiplier, e.g. 0.10 = 10% of input price
  source: string;
  notes?: string;
}

const REFERENCE_PRICES: Record<string, ReferencePricing> = {
  // ── Google Gemini ── (all prices for prompts ≤200K tokens)
  'gemini-3.1-pro-preview': {
    inputPer1M: 2.00, outputPer1M: 12.00, thinkingPer1M: 12.00, cachedInputDiscount: 0.10,
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-pro-preview',
    notes: '>200K: input $4.00, output $18.00',
  },
  'gemini-3-flash-preview': {
    inputPer1M: 0.50, outputPer1M: 3.00, thinkingPer1M: 3.00, cachedInputDiscount: 0.10,
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3-flash-preview',
  },
  'gemini-3-pro-preview': {
    inputPer1M: 2.00, outputPer1M: 12.00, thinkingPer1M: 12.00, cachedInputDiscount: 0.10,
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3-pro-preview',
    notes: '>200K: input $4.00, output $18.00. Deprecated — migrate to 3.1 Pro.',
  },
  'gemini-2.5-flash': {
    inputPer1M: 0.30, outputPer1M: 2.50, thinkingPer1M: 2.50, cachedInputDiscount: 0.10,
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash',
  },
  'gemini-2.5-flash-lite': {
    inputPer1M: 0.10, outputPer1M: 0.40, cachedInputDiscount: 0.10,
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite',
  },
  'gemini-2.5-pro': {
    inputPer1M: 1.25, outputPer1M: 10.00, thinkingPer1M: 10.00, cachedInputDiscount: 0.10,
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-pro',
    notes: '>200K: input $2.50, output $15.00',
  },
  'gemini-embedding-001': {
    inputPer1M: 0.15, outputPer1M: 0,
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-embedding',
  },

  // ── OpenAI ──
  'gpt-5.2': {
    inputPer1M: 1.75, outputPer1M: 14.00, cachedInputDiscount: 0.10,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  'gpt-5.2-pro': {
    inputPer1M: 21.00, outputPer1M: 168.00,
    source: 'https://developers.openai.com/api/docs/pricing',
    notes: 'No cached input pricing available.',
  },
  'gpt-5.1': {
    inputPer1M: 1.25, outputPer1M: 10.00, cachedInputDiscount: 0.10,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  'gpt-5': {
    inputPer1M: 1.25, outputPer1M: 10.00, cachedInputDiscount: 0.10,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  'gpt-5-mini': {
    inputPer1M: 0.25, outputPer1M: 2.00, cachedInputDiscount: 0.10,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  'gpt-5-nano': {
    inputPer1M: 0.05, outputPer1M: 0.40, cachedInputDiscount: 0.10,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  'gpt-4.1': {
    inputPer1M: 2.00, outputPer1M: 8.00, cachedInputDiscount: 0.25,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  'gpt-4.1-mini': {
    inputPer1M: 0.40, outputPer1M: 1.60, cachedInputDiscount: 0.25,
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  'o3': {
    inputPer1M: 2.00, outputPer1M: 8.00, thinkingPer1M: 8.00, cachedInputDiscount: 0.25,
    source: 'https://developers.openai.com/api/docs/pricing',
    notes: 'Reasoning tokens billed as output tokens.',
  },
  'o4-mini': {
    inputPer1M: 1.10, outputPer1M: 4.40, thinkingPer1M: 4.40, cachedInputDiscount: 0.25,
    source: 'https://developers.openai.com/api/docs/pricing',
    notes: 'Reasoning tokens billed as output tokens.',
  },
  'gpt-realtime-2025-08-28': {
    inputPer1M: 5.00, outputPer1M: 20.00,
    source: 'https://developers.openai.com/api/docs/pricing',
    notes: 'Text token pricing. Audio is $40/$80 separately.',
  },
  'gpt-image-1': {
    inputPer1M: 0, outputPer1M: 0,
    source: 'https://developers.openai.com/api/docs/pricing',
    notes: 'Image generation priced per image, not per token.',
  },

  // ── Anthropic ──
  'claude-opus-4-6': {
    inputPer1M: 5.00, outputPer1M: 25.00, cachedInputDiscount: 0.10,
    source: 'https://platform.claude.com/docs/en/docs/about-claude/pricing',
    notes: 'Cache write = 1.25× input. >200K input triggers 1M context rates (2× input, 1.5× output).',
  },
  'claude-sonnet-4-6': {
    inputPer1M: 3.00, outputPer1M: 15.00, cachedInputDiscount: 0.10,
    source: 'https://platform.claude.com/docs/en/docs/about-claude/pricing',
    notes: 'Cache write = 1.25× input.',
  },
  'claude-haiku-4-5': {
    inputPer1M: 1.00, outputPer1M: 5.00, cachedInputDiscount: 0.10,
    source: 'https://platform.claude.com/docs/en/docs/about-claude/pricing',
    notes: 'Cache write = 1.25× input.',
  },
};

// ──────────────────────────────────────────────────────────────
// Validation logic
// ──────────────────────────────────────────────────────────────

interface Discrepancy {
  model: string;
  field: string;
  registryValue: number | undefined;
  referenceValue: number | undefined;
  pctDrift: string;
}

function validate(): { discrepancies: Discrepancy[]; missing: string[]; unvalidated: string[] } {
  const discrepancies: Discrepancy[] = [];
  const missing: string[] = [];
  const unvalidated: string[] = [];

  // Check every model in the registry against reference
  for (const model of SUPPORTED_MODELS) {
    const ref = REFERENCE_PRICES[model.id];
    if (!ref) {
      unvalidated.push(model.id);
      continue;
    }

    const checks: { field: string; registry: number | undefined; reference: number | undefined }[] = [
      { field: 'inputPer1M', registry: model.inputPer1M, reference: ref.inputPer1M },
      { field: 'outputPer1M', registry: model.outputPer1M, reference: ref.outputPer1M },
      { field: 'thinkingPer1M', registry: model.thinkingPer1M, reference: ref.thinkingPer1M },
      { field: 'cachedInputDiscount', registry: model.cachedInputDiscount, reference: ref.cachedInputDiscount },
    ];

    for (const c of checks) {
      const regVal = c.registry ?? undefined;
      const refVal = c.reference ?? undefined;

      // Both undefined = OK
      if (regVal === undefined && refVal === undefined) continue;

      // One defined, other not
      if (regVal === undefined || refVal === undefined) {
        discrepancies.push({
          model: model.id,
          field: c.field,
          registryValue: regVal,
          referenceValue: refVal,
          pctDrift: 'N/A',
        });
        continue;
      }

      // Both defined — check if they match
      if (Math.abs(regVal - refVal) > 0.001) {
        const pct = refVal !== 0
          ? `${(((regVal - refVal) / refVal) * 100).toFixed(1)}%`
          : 'INF';
        discrepancies.push({
          model: model.id,
          field: c.field,
          registryValue: regVal,
          referenceValue: refVal,
          pctDrift: pct,
        });
      }
    }
  }

  // Check for reference entries not in registry
  for (const refId of Object.keys(REFERENCE_PRICES)) {
    if (!SUPPORTED_MODELS.some(m => m.id === refId)) {
      missing.push(refId);
    }
  }

  return { discrepancies, missing, unvalidated };
}

// ──────────────────────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────────────────────

const { discrepancies, missing, unvalidated } = validate();

console.log('\n══════════════════════════════════════════════════');
console.log('  MODEL PRICING VALIDATION REPORT');
console.log('══════════════════════════════════════════════════\n');

if (discrepancies.length === 0) {
  console.log('✅ All registry prices match reference values.\n');
} else {
  console.log(`❌ ${discrepancies.length} PRICING DISCREPANCIES FOUND:\n`);
  console.log(
    'Model'.padEnd(28) +
    'Field'.padEnd(22) +
    'Registry'.padEnd(12) +
    'Reference'.padEnd(12) +
    'Drift'
  );
  console.log('─'.repeat(80));
  for (const d of discrepancies) {
    console.log(
      d.model.padEnd(28) +
      d.field.padEnd(22) +
      String(d.registryValue ?? '—').padEnd(12) +
      String(d.referenceValue ?? '—').padEnd(12) +
      d.pctDrift
    );
  }
  console.log();
}

if (unvalidated.length > 0) {
  console.log(`⚠️  ${unvalidated.length} models have no reference pricing (not validated):`);
  for (const id of unvalidated) console.log(`   • ${id}`);
  console.log();
}

if (missing.length > 0) {
  console.log(`⚠️  ${missing.length} reference entries not in registry:`);
  for (const id of missing) console.log(`   • ${id}`);
  console.log();
}

// Summary
console.log('──────────────────────────────────────────────────');
console.log(`Registry models:  ${SUPPORTED_MODELS.length}`);
console.log(`Validated:        ${SUPPORTED_MODELS.length - unvalidated.length}`);
console.log(`Discrepancies:    ${discrepancies.length}`);
console.log(`Status:           ${discrepancies.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
console.log('──────────────────────────────────────────────────\n');

process.exit(discrepancies.length > 0 ? 1 : 0);
