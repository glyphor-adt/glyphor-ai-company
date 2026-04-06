import { ModelClient, type ToolContext, type ToolDefinition, type ToolResult } from '@glyphor/agent-runtime';
import { getTierModel } from '@glyphor/shared';

interface ComponentSpec {
  name: string;
  priority: number;
  interaction_intent: string;
  motion_intent: string;
}

interface AssetSpec {
  name: string;
  type: 'concept' | 'product_shot' | 'editorial' | 'pattern' | 'hero_loop' | 'product_demo' | 'promo';
  purpose: string;
  path_hint: string;
}

interface NormalizedDesignBrief {
  audience_persona: string;
  primary_conversion_action: string;
  emotional_target: string;
  one_sentence_memory: string;
  aesthetic_direction: string;
  product_type: 'marketing_page' | 'web_application' | 'fullstack_application';
  component_inventory: ComponentSpec[];
  asset_manifest: {
    images: AssetSpec[];
    videos: AssetSpec[];
  };
  quality_contract: {
    required_breakpoints: number[];
    required_checks: string[];
    max_iteration_rounds: number;
  };
  missing_fields: string[];
}

interface ModelEnhancedBrief {
  audience_persona?: string;
  primary_conversion_action?: string;
  emotional_target?: string;
  one_sentence_memory?: string;
  aesthetic_direction?: string;
  product_type?: NormalizedDesignBrief['product_type'];
  section_candidates?: string[];
}

const PROMPT_NORMALIZER_MODEL = process.env.USER_PROMPT_NORMALIZER_MODEL?.trim() || getTierModel('default');

const USER_PROMPT_NORMALIZER = `ROLE: USER PROMPT ENHANCER (WEB / WEB APP BUILDER)
You convert a short user request into a richer, build-ready design direction for a website or web app.

Return ONLY valid JSON with this exact shape and keys:
{
  "audience_persona": "string",
  "primary_conversion_action": "string",
  "emotional_target": "string",
  "one_sentence_memory": "string",
  "aesthetic_direction": "string",
  "product_type": "marketing_page | web_application | fullstack_application",
  "section_candidates": ["string"]
}

Rules:
- Do not invent factual claims (awards, years in business, exact pricing, ratings, partnerships).
- Keep output implementation-friendly and specific.
- If prompt is short, infer practical defaults from the actual domain in the prompt.
- Never inject platform-specific marketing copy unless user asked for that platform.
- If CTA style hints are provided (outline, ghost, text-only, light fill), reflect that in aesthetic_direction.
- section_candidates should be 3-8 concise ids in snake_case.`;

const DEFAULT_COMPONENTS: ComponentSpec[] = [
  {
    name: 'hero',
    priority: 1,
    interaction_intent: 'Drive immediate comprehension and CTA engagement',
    motion_intent: 'Headline reveal then CTA emphasis',
  },
  {
    name: 'value_proposition',
    priority: 2,
    interaction_intent: 'Explain core capabilities quickly',
    motion_intent: 'Staggered reveal of capability blocks',
  },
  {
    name: 'cta_section',
    priority: 3,
    interaction_intent: 'Capture conversion action',
    motion_intent: 'Focused attention transition and hover feedback',
  },
  {
    name: 'footer',
    priority: 4,
    interaction_intent: 'Provide trust and navigation closure',
    motion_intent: 'Minimal fade-in for final section',
  },
];

/** When the brief is an app (not a marketing page), avoid hero/CTA landing defaults. */
const APP_DEFAULT_COMPONENTS: ComponentSpec[] = [
  {
    name: 'app_shell',
    priority: 1,
    interaction_intent: 'Global layout, navigation, and state relevant to the product',
    motion_intent: 'Subtle transitions; no marketing-page theatrics unless the brief asks',
  },
  {
    name: 'primary_feature_surface',
    priority: 2,
    interaction_intent: 'The main screen where users accomplish the core task from the brief',
    motion_intent: 'Responsive feedback for data loading, input, and results',
  },
  {
    name: 'supporting_controls',
    priority: 3,
    interaction_intent: 'Search, location, settings, or secondary actions implied by the brief',
    motion_intent: 'Clear affordances and accessible controls',
  },
];

function truncateDirectiveSummary(text: string, maxChars = 220): string {
  const t = normalizeWhitespace(text);
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars).trim()}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractQuoted(text: string): string | null {
  const match = text.match(/"([^"]+)"/);
  return match?.[1] ? normalizeWhitespace(match[1]) : null;
}

function extractAfterLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n]+)`, 'i');
    const match = text.match(regex);
    if (match?.[1]) return normalizeWhitespace(match[1]);
  }
  return null;
}

function parseSectionList(text: string): string[] {
  const sectionLine = extractAfterLabel(text, ['sections', 'components', 'required sections']);
  if (!sectionLine) return [];
  return sectionLine
    .split(/[;,]/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function inferProductType(text: string, explicit?: string): NormalizedDesignBrief['product_type'] {
  const raw = (explicit ?? '').toLowerCase().trim();
  if (raw === 'web_application') return 'web_application';
  if (raw === 'fullstack_application') return 'fullstack_application';
  if (raw === 'marketing_page') return 'marketing_page';

  const lower = text.toLowerCase();
  if (/(database|auth|api|full-?stack|cloud sql|firebase|backend)/.test(lower)) {
    return 'fullstack_application';
  }
  if (/\b(weather|forecast|radar)\b/.test(lower)) {
    return 'web_application';
  }
  if (/(dashboard|app|workspace|portal|console)/.test(lower)) {
    return 'web_application';
  }
  return 'marketing_page';
}

function createPromptNormalizerModelClient(): ModelClient {
  return new ModelClient({
    geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY,
    azureFoundryEndpoint: process.env.AZURE_FOUNDRY_ENDPOINT,
    azureFoundryApi: process.env.AZURE_FOUNDRY_API,
    azureFoundryApiVersion: process.env.AZURE_FOUNDRY_API_VERSION,
  });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSectionCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? normalizeWhitespace(item).toLowerCase().replace(/\s+/g, '_') : ''))
    .filter(Boolean)
    .slice(0, 8);
}

async function enhanceBriefWithModel(
  directiveText: string,
  inferredProductType: NormalizedDesignBrief['product_type'],
  ctx: ToolContext,
): Promise<ModelEnhancedBrief | null> {
  try {
    const client = createPromptNormalizerModelClient();
    const userContent = [
      `inferred_product_type: ${inferredProductType}`,
      'user_request:',
      directiveText,
    ].join('\n');

    const result = await client.generate({
      model: PROMPT_NORMALIZER_MODEL,
      systemInstruction: USER_PROMPT_NORMALIZER,
      contents: [{ role: 'user', content: userContent, timestamp: Date.now() }],
      temperature: 0.35,
      maxTokens: 1200,
      callTimeoutMs: Math.max(30_000, Number(process.env.USER_PROMPT_NORMALIZER_TIMEOUT_MS ?? '90000')),
      signal: ctx.abortSignal,
      source: 'on_demand',
      metadata: {
        agentRole: ctx.agentRole,
        runId: ctx.runId,
        assignmentId: ctx.assignmentId,
        turnNumber: ctx.turnNumber,
      },
    });

    const parsed = parseJsonObject(result.text ?? '');
    if (!parsed) return null;

    const productType = asNonEmptyString(parsed.product_type) as NormalizedDesignBrief['product_type'] | undefined;
    return {
      audience_persona: asNonEmptyString(parsed.audience_persona),
      primary_conversion_action: asNonEmptyString(parsed.primary_conversion_action),
      emotional_target: asNonEmptyString(parsed.emotional_target),
      one_sentence_memory: asNonEmptyString(parsed.one_sentence_memory),
      aesthetic_direction: asNonEmptyString(parsed.aesthetic_direction),
      product_type: productType,
      section_candidates: normalizeSectionCandidates(parsed.section_candidates),
    };
  } catch {
    return null;
  }
}

function buildComponentInventory(sections: string[]): ComponentSpec[] {
  if (sections.length === 0) return DEFAULT_COMPONENTS;

  return sections.map((section, index) => ({
    name: section.toLowerCase().replace(/\s+/g, '_'),
    priority: index + 1,
    interaction_intent: `User completes the primary action in ${section}`,
    motion_intent: `Section-specific entrance and interaction feedback for ${section}`,
  }));
}

function buildAssetManifest(components: ComponentSpec[]): NormalizedDesignBrief['asset_manifest'] {
  const images: AssetSpec[] = [];
  const videos: AssetSpec[] = [];

  const hasHero = components.some((c) => c.name.includes('hero'));
  if (hasHero) {
    images.push({
      name: 'hero-background',
      type: 'concept',
      purpose: 'Primary visual atmosphere and mood anchoring',
      path_hint: '/images/hero-background.jpg',
    });
  }

  const hasCapability = components.some((c) => c.name.includes('value') || c.name.includes('feature'));
  if (hasCapability) {
    images.push({
      name: 'capability-context',
      type: 'product_shot',
      purpose: 'Product shown in realistic context',
      path_hint: '/images/capability-context.jpg',
    });
  }

  images.push({
    name: 'ambient-pattern',
    type: 'pattern',
    purpose: 'Background texture layer for section separation',
    path_hint: '/images/ambient-pattern.png',
  });

  videos.push({
    name: 'hero-loop',
    type: 'hero_loop',
    purpose: 'Ambient short loop for hero motion depth',
    path_hint: '/videos/hero-loop.mp4',
  });

  return { images, videos };
}

export function createDesignBriefTools(): ToolDefinition[] {
  return [
    {
      name: 'normalize_design_brief',
      description:
        'Normalize a raw web directive into a structured design brief (persona, conversion target, components, assets) for downstream `build_website_foundation`. '
        + 'Uses **marketing-leaning defaults** for `marketing_page` and **app-leaning defaults** for `web_application` / `fullstack_application` when labeled fields are missing — so short requests like "build a weather app" are not forced into waitlist/hero landing patterns.',
      parameters: {
        directive_text: {
          type: 'string',
          description: 'Raw directive text describing the requested website or web application.',
          required: true,
        },
        product_type: {
          type: 'string',
          description: 'Optional explicit type: marketing_page, web_application, fullstack_application.',
          required: false,
          enum: ['marketing_page', 'web_application', 'fullstack_application'],
        },
      },
      async execute(params, ctx: ToolContext): Promise<ToolResult> {
        const directiveText = String(params.directive_text ?? '').trim();
        if (!directiveText) {
          return { success: false, error: 'directive_text is required.' };
        }

        const inferredProductType = inferProductType(directiveText, params.product_type as string | undefined);
        const enhanced = await enhanceBriefWithModel(directiveText, inferredProductType, ctx);
        const productType = inferProductType(
          directiveText,
          (enhanced?.product_type as string | undefined) ?? (params.product_type as string | undefined),
        );
        const isApp = productType === 'web_application' || productType === 'fullstack_application';

        const audiencePersona =
          extractAfterLabel(directiveText, ['target audience', 'audience', 'who this is for'])
          ?? enhanced?.audience_persona
          ?? (isApp
            ? 'End users completing real tasks in this application.'
            : 'People likely to buy, book, attend, or inquire based on this page.');

        const primaryConversion =
          extractAfterLabel(directiveText, ['single cta', 'primary cta', 'conversion action', 'cta'])
          ?? enhanced?.primary_conversion_action
          ?? (isApp
            ? 'Complete the core in-app task described in the brief (not a marketing signup unless the brief explicitly asks for one).'
            : 'Take the primary action for this offering (for example: book, buy, join, or request info).');

        const emotionalTarget =
          extractAfterLabel(directiveText, ['tone', 'emotional target', 'what they should feel'])
          ?? enhanced?.emotional_target
          ?? (isApp
            ? 'Clarity and confidence — the product feels straightforward and dependable.'
            : 'Trust and excitement appropriate to the offering and audience.');

        const oneSentenceMemory =
          extractAfterLabel(directiveText, ['one-sentence memory', 'one thing they should remember', 'memory'])
          ?? extractQuoted(directiveText)
          ?? enhanced?.one_sentence_memory
          ?? truncateDirectiveSummary(directiveText);

        const aestheticDirection =
          extractAfterLabel(directiveText, ['visual direction', 'aesthetic direction'])
          ?? enhanced?.aesthetic_direction
          ?? (isApp
            ? 'Clean, functional UI appropriate to the use case in the brief; strong readability and accessible contrast.'
            : 'Visual direction that matches the business domain in the brief with strong hierarchy and accessible contrast.');

        const sections = parseSectionList(directiveText);
        const sectionCandidates = sections.length > 0 ? sections : (enhanced?.section_candidates ?? []);
        const componentInventory = sectionCandidates.length > 0
          ? buildComponentInventory(sectionCandidates)
          : (isApp ? APP_DEFAULT_COMPONENTS : DEFAULT_COMPONENTS);
        const assetManifest = buildAssetManifest(componentInventory);

        const missingFields: string[] = [];
        if (!extractAfterLabel(directiveText, ['target audience', 'audience', 'who this is for'])) missingFields.push('audience_persona');
        if (!extractAfterLabel(directiveText, ['single cta', 'primary cta', 'conversion action', 'cta'])) missingFields.push('primary_conversion_action');
        if (!extractAfterLabel(directiveText, ['tone', 'emotional target', 'what they should feel'])) missingFields.push('emotional_target');
        if (!extractAfterLabel(directiveText, ['one-sentence memory', 'one thing they should remember', 'memory']) && !extractQuoted(directiveText)) {
          missingFields.push('one_sentence_memory');
        }
        if (!extractAfterLabel(directiveText, ['visual direction', 'aesthetic direction'])) missingFields.push('aesthetic_direction');

        const normalized: NormalizedDesignBrief = {
          audience_persona: audiencePersona,
          primary_conversion_action: primaryConversion,
          emotional_target: emotionalTarget,
          one_sentence_memory: oneSentenceMemory,
          aesthetic_direction: aestheticDirection,
          product_type: productType,
          component_inventory: componentInventory,
          asset_manifest: assetManifest,
          quality_contract: {
            required_breakpoints: [1440, 1024, 768, 375],
            required_checks: ['check_ai_smell', 'run_accessibility_audit'],
            max_iteration_rounds: 3,
          },
          missing_fields: missingFields,
        };

        return {
          success: true,
          data: normalized,
        };
      },
    },
  ];
}
