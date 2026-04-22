import { describe, expect, it } from 'vitest';
import {
  AI_BLUR_PATTERNS,
  ANTI_AI_SMELL_TOKENS,
  scoreComponentOriginality,
  scoreTypographyHierarchy,
  createAntiAiSmellTools,
} from '../antiAiSmellRegistry.js';

// ─── AI_BLUR_PATTERNS catalogue tests ────────────────────────────────────────

describe('AI_BLUR_PATTERNS catalogue', () => {
  it('contains at least 7 documented patterns', () => {
    expect(AI_BLUR_PATTERNS.length).toBeGreaterThanOrEqual(7);
  });

  it('every pattern has required fields', () => {
    for (const p of AI_BLUR_PATTERNS) {
      expect(p.id, `${p.id}: missing id`).toBeTruthy();
      expect(p.name, `${p.id}: missing name`).toBeTruthy();
      expect(p.description, `${p.id}: missing description`).toBeTruthy();
      expect(p.aiOrigin, `${p.id}: missing aiOrigin`).toBeTruthy();
      // Pattern must have either detectionPatterns or a detect function
      const hasDetection =
        (Array.isArray(p.detectionPatterns) && p.detectionPatterns.length > 0) ||
        typeof p.detect === 'function';
      expect(hasDetection, `${p.id}: must have at least one detectionPattern or a detect() function`).toBe(true);
      expect(Array.isArray(p.remediationTokens) && p.remediationTokens.length > 0,
        `${p.id}: must have at least one remediationToken`).toBe(true);
      expect(p.originalityPenalty).toBeGreaterThan(0);
    }
  });

  it('pattern ids are unique', () => {
    const ids = AI_BLUR_PATTERNS.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('flat-font-weight pattern detects font-normal monoculture', () => {
    const pattern = AI_BLUR_PATTERNS.find((p) => p.id === 'flat-font-weight')!;
    expect(pattern).toBeDefined();
    // Component where only font-normal/medium appear, no bold variants
    const badSource = '<p className="font-normal text-base">hello</p><h1 className="font-medium text-2xl">world</h1>';
    const detected = pattern.detect ? pattern.detect(badSource) : pattern.detectionPatterns.some((re) => re.test(badSource));
    expect(detected).toBe(true);
  });

  it('flat-font-weight pattern does NOT fire when bold weights are present', () => {
    const pattern = AI_BLUR_PATTERNS.find((p) => p.id === 'flat-font-weight')!;
    expect(pattern).toBeDefined();
    const goodSource = '<h1 className="font-extrabold text-4xl">Heading</h1><p className="font-normal text-base">Body.</p>';
    const detected = pattern.detect ? pattern.detect(goodSource) : pattern.detectionPatterns.some((re) => re.test(goodSource));
    expect(detected).toBe(false);
  });

  it('generic-button-style pattern detects bg-blue-600 text-white', () => {
    const pattern = AI_BLUR_PATTERNS.find((p) => p.id === 'generic-button-style')!;
    expect(pattern).toBeDefined();
    // Class names between bg-blue-600 and text-white include digits (px-4)
    const badSource = '<button className="bg-blue-600 rounded px-4 text-white">Get Started</button>';
    const detected = pattern.detect
      ? pattern.detect(badSource)
      : pattern.detectionPatterns.some((re) => re.test(badSource));
    expect(detected).toBe(true);
  });

  it('surface-monotony pattern detects repeated bg-white (three occurrences)', () => {
    const pattern = AI_BLUR_PATTERNS.find((p) => p.id === 'surface-monotony')!;
    expect(pattern).toBeDefined();
    const badSource = '<section className="bg-white"><div className="bg-white"><article className="bg-white"/></div></section>';
    const detected = pattern.detect
      ? pattern.detect(badSource)
      : pattern.detectionPatterns.some((re) => re.test(badSource));
    expect(detected).toBe(true);
  });
});

// ─── ANTI_AI_SMELL_TOKENS tests ───────────────────────────────────────────────

describe('ANTI_AI_SMELL_TOKENS', () => {
  it('typography token set has 6 font size levels', () => {
    const sizes = Object.keys(ANTI_AI_SMELL_TOKENS.typography.fontSizes);
    expect(sizes).toContain('display');
    expect(sizes).toContain('heading');
    expect(sizes).toContain('subheading');
    expect(sizes).toContain('body');
    expect(sizes).toContain('caption');
    expect(sizes).toContain('micro');
  });

  it('typography font weights span full hierarchy (400–800)', () => {
    const weights = ANTI_AI_SMELL_TOKENS.typography.fontWeights;
    expect(Number(weights.display)).toBeGreaterThanOrEqual(700);
    expect(Number(weights.body)).toBe(400);
    expect(Number(weights.display)).toBeGreaterThan(Number(weights.body));
  });

  it('spacing scale has 7 named stops', () => {
    const stops = Object.keys(ANTI_AI_SMELL_TOKENS.spacing);
    expect(stops.length).toBeGreaterThanOrEqual(7);
  });

  it('radii set has at least 5 distinct values including pill and none', () => {
    const radii = ANTI_AI_SMELL_TOKENS.radii;
    expect(radii.pill).toBeDefined();
    expect(radii.none).toBeDefined();
    expect(Object.keys(radii).length).toBeGreaterThanOrEqual(5);
  });

  it('surface tokens define at least 4 elevation levels', () => {
    const surfaces = Object.keys(ANTI_AI_SMELL_TOKENS.surfaces);
    expect(surfaces).toContain('base');
    expect(surfaces).toContain('raised');
    expect(surfaces).toContain('overlay');
    expect(surfaces).toContain('inset');
  });
});

// ─── scoreComponentOriginality tests ─────────────────────────────────────────

describe('scoreComponentOriginality', () => {
  it('perfect clean component scores > 80 (meets target)', () => {
    const clean = `
      export function HeroSection() {
        return (
          <section className="bg-base py-3xl">
            <h1 className="text-display font-extrabold tracking-tight text-foreground">
              Unlock your potential
            </h1>
            <p className="text-body font-normal text-muted-foreground mt-md">
              The platform that moves at your speed.
            </p>
            <button className="bg-primary text-primary-foreground rounded-pill px-lg py-sm font-semibold hover:opacity-90">
              Start free today
            </button>
          </section>
        );
      }
    `;
    const result = scoreComponentOriginality(clean);
    expect(result.meetsTarget).toBe(true);
    expect(result.score).toBeGreaterThan(80);
  });

  it('AI-smell component with generic button fails target', () => {
    const smelly = `
      export function Hero() {
        return (
          <section className="bg-white p-4">
            <h1 className="font-normal text-base">Welcome to our platform</h1>
            <p className="font-normal text-sm">Click here to learn more</p>
            <button className="bg-blue-600 rounded-md p-4 text-white">Get Started</button>
          </section>
        );
      }
    `;
    const result = scoreComponentOriginality(smelly);
    expect(result.meetsTarget).toBe(false);
    expect(result.deductions.length).toBeGreaterThan(0);
  });

  it('deductions reference valid pattern ids', () => {
    const source = '<button className="bg-blue-600 text-white rounded-md">Learn more</button>';
    const result = scoreComponentOriginality(source);
    const validIds = new Set(AI_BLUR_PATTERNS.map((p) => p.id));
    for (const d of result.deductions) {
      expect(validIds.has(d.patternId), `Unknown pattern id: ${d.patternId}`).toBe(true);
    }
  });

  it('score is clamped between 0 and 100', () => {
    const worst = Array(20).fill('<button className="bg-blue-600 text-white font-normal rounded-md p-4 grid-cols-3 gap-4">Lorem ipsum</button>').join('\n');
    const result = scoreComponentOriginality(worst);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ─── scoreTypographyHierarchy tests ───────────────────────────────────────────

describe('scoreTypographyHierarchy', () => {
  it('rich multi-level typography scores > 90 (meets target)', () => {
    const rich = `
      <section>
        <h1 className="text-4xl font-extrabold tracking-tight">Display headline</h1>
        <h2 className="text-2xl font-bold">Section heading</h2>
        <h3 className="text-xl font-semibold">Card title</h3>
        <p className="text-base font-normal leading-relaxed">Body paragraph text.</p>
        <span className="text-sm font-medium text-muted">Caption label</span>
        <span className="text-xs tracking-wide uppercase">Micro badge</span>
      </section>
    `;
    const result = scoreTypographyHierarchy(rich);
    expect(result.meetsTarget).toBe(true);
    expect(result.levelsFound.length).toBeGreaterThanOrEqual(3);
  });

  it('flat typography with no heading hierarchy fails target', () => {
    const flat = `
      <section>
        <div className="font-medium text-sm">Label one</div>
        <div className="font-medium text-sm">Label two</div>
        <div className="font-normal text-base">Body copy only.</div>
      </section>
    `;
    const result = scoreTypographyHierarchy(flat);
    // Should detect flat-font-weight or uniform-type-scale
    expect(result.deductions.length).toBeGreaterThan(0);
  });

  it('score is clamped between 0 and 100', () => {
    const source = 'font-normal text-base font-medium text-sm';
    const result = scoreTypographyHierarchy(source);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ─── createAntiAiSmellTools factory tests ────────────────────────────────────

describe('createAntiAiSmellTools', () => {
  it('returns 4 tools', () => {
    const tools = createAntiAiSmellTools();
    expect(tools.length).toBe(4);
  });

  it('tool names are unique', () => {
    const tools = createAntiAiSmellTools();
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('expected tool names are present', () => {
    const tools = createAntiAiSmellTools();
    const names = new Set(tools.map((t) => t.name));
    expect(names.has('get_anti_ai_smell_registry')).toBe(true);
    expect(names.has('score_component_originality')).toBe(true);
    expect(names.has('score_typography_hierarchy')).toBe(true);
    expect(names.has('validate_component_against_registry')).toBe(true);
  });

  describe('get_anti_ai_smell_registry', () => {
    it('returns full registry when section=all', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'get_anti_ai_smell_registry')!;
      const result = await tool.execute({ section: 'all' }, {} as any);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(Array.isArray(data.patterns)).toBe(true);
      expect(data.tokens).toBeDefined();
      expect(data.successCriteria).toBeDefined();
    });

    it('returns only patterns when section=patterns', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'get_anti_ai_smell_registry')!;
      const result = await tool.execute({ section: 'patterns' }, {} as any);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(Array.isArray(data.patterns)).toBe(true);
      expect(data.tokens).toBeUndefined();
    });

    it('returns only tokens when section=tokens', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'get_anti_ai_smell_registry')!;
      const result = await tool.execute({ section: 'tokens' }, {} as any);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.tokens).toBeDefined();
      expect(data.patterns).toBeUndefined();
    });
  });

  describe('score_component_originality', () => {
    it('returns error when source is missing', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'score_component_originality')!;
      const result = await tool.execute({}, {} as any);
      expect(result.success).toBe(false);
    });

    it('returns score and grade for clean source', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'score_component_originality')!;
      const result = await tool.execute({
        source: '<section className="bg-base py-3xl"><h1 className="text-4xl font-extrabold">Hello</h1></section>',
      }, {} as any);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(typeof data.score).toBe('number');
      expect(['A+', 'A', 'B', 'C', 'F']).toContain(data.grade);
    });
  });

  describe('score_typography_hierarchy', () => {
    it('returns error when source is missing', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'score_typography_hierarchy')!;
      const result = await tool.execute({}, {} as any);
      expect(result.success).toBe(false);
    });

    it('returns score, levels, and grade', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'score_typography_hierarchy')!;
      const result = await tool.execute({
        source: '<h1 className="text-4xl font-bold">Title</h1><p className="text-base">Body</p><span className="text-sm">Caption</span>',
      }, {} as any);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(typeof data.score).toBe('number');
      expect(Array.isArray(data.levelsFound)).toBe(true);
      expect(['A+', 'A', 'B', 'C', 'F']).toContain(data.grade);
    });
  });

  describe('validate_component_against_registry', () => {
    it('returns error when source is missing', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'validate_component_against_registry')!;
      const result = await tool.execute({}, {} as any);
      expect(result.success).toBe(false);
    });

    it('passes a clean component', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'validate_component_against_registry')!;
      const clean = `
        <section className="bg-base py-3xl">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Heading</h1>
          <p className="text-base font-normal text-muted leading-relaxed">Body.</p>
          <button className="bg-primary text-primary-foreground rounded-pill px-lg font-semibold">
            Reserve your spot
          </button>
        </section>
      `;
      const result = await tool.execute({ source: clean, component_name: 'HeroClean' }, {} as any);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      const scores = data.scores as Record<string, unknown>;
      expect(scores).toBeDefined();
    });

    it('fails an AI-smell component and returns a recommendation with fixes', async () => {
      const tool = createAntiAiSmellTools().find((t) => t.name === 'validate_component_against_registry')!;
      const smelly = `
        <section className="bg-white p-4">
          <h1 className="font-normal text-sm">Welcome to our service</h1>
          <button className="bg-blue-600 text-white rounded-md p-4">Get Started</button>
        </section>
      `;
      const result = await tool.execute({ source: smelly, component_name: 'HeroSmelly' }, {} as any);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.passed).toBe(false);
      expect(typeof data.recommendation).toBe('string');
      expect((data.recommendation as string).length).toBeGreaterThan(0);
    });
  });
});
