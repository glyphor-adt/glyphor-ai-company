import { systemQuery } from '@glyphor/shared/db';

type HealthLevel = 'PASS' | 'WARN' | 'FAIL';

interface CheckResult {
  level: HealthLevel;
  message: string;
}

interface DoctrineRow {
  section: string;
  title: string;
  content: string;
  audience: string;
  is_active: boolean;
}

interface BulletinRow {
  content: string;
  priority: string;
  audience: string;
  is_active: boolean;
  created_at: string;
}

const REQUIRED_SECTIONS = [
  'mission',
  'current_priorities',
  'authority_model',
  'operating_doctrine',
  'products',
  'pricing',
  'decision_log',
] as const;

const legacyWebBuildName = `${'Fu'}se`;

const FORBIDDEN_BULLETIN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'telemetry blackout priority', pattern: /telemetry blackout/i },
  { label: 'enterprise prospect research priority', pattern: /enterprise prospect research/i },
  { label: 'legacy low-ticket pricing', pattern: /\$15\s*[-–]\s*\$50/i },
  { label: 'legacy web build pricing ladder', pattern: new RegExp(`${legacyWebBuildName.toLowerCase()}\\s*:\\s*free tier`, 'i') },
  { label: 'deprecated Pulse launch messaging', pattern: /pulse launch messaging|product hunt\s*\/\s*pulse launch|product hunt/i },
];

function parseArgs(argv: string[]): { audience: string } {
  const audienceArg = readArg(argv, '--audience') ?? 'all';
  return { audience: audienceArg };
}

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function preview(value: string, max = 140): string {
  const normalized = compactWhitespace(value);
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

function checkContains(
  checks: CheckResult[],
  section: DoctrineRow | undefined,
  expectedLabel: string,
  pattern: RegExp,
  severity: HealthLevel = 'FAIL',
): void {
  if (!section) return;
  if (pattern.test(section.content)) {
    checks.push({ level: 'PASS', message: `${section.section}: includes ${expectedLabel}.` });
    return;
  }

  checks.push({
    level: severity,
    message: `${section.section}: missing ${expectedLabel}.`,
  });
}

function checkAbsent(
  checks: CheckResult[],
  section: DoctrineRow | undefined,
  forbiddenLabel: string,
  pattern: RegExp,
): void {
  if (!section) return;
  if (!pattern.test(section.content)) {
    checks.push({ level: 'PASS', message: `${section.section}: no ${forbiddenLabel}.` });
    return;
  }

  checks.push({
    level: 'FAIL',
    message: `${section.section}: contains forbidden ${forbiddenLabel}.`,
  });
}

function checkLegacyMentionIsDeprecated(
  checks: CheckResult[],
  section: DoctrineRow | undefined,
  pattern: RegExp,
  deprecationPattern: RegExp,
): void {
  if (!section) return;
  if (!pattern.test(section.content)) {
    checks.push({ level: 'PASS', message: `${section.section}: no legacy low-ticket pricing mention.` });
    return;
  }

  if (deprecationPattern.test(section.content)) {
    checks.push({ level: 'PASS', message: `${section.section}: legacy low-ticket pricing mention is explicitly deprecated.` });
    return;
  }

  checks.push({ level: 'FAIL', message: `${section.section}: legacy low-ticket pricing appears without deprecation guardrail.` });
}

async function loadDoctrine(audience: string): Promise<Map<string, DoctrineRow>> {
  const rows = await systemQuery<DoctrineRow>(
    `SELECT section, title, content, audience, is_active
     FROM company_knowledge_base
     WHERE is_active = true
       AND (audience = 'all' OR audience = $1)`,
    [audience],
  );

  return new Map(rows.map((row) => [row.section, row]));
}

async function loadActiveBulletins(audience: string): Promise<BulletinRow[]> {
  return systemQuery<BulletinRow>(
    `SELECT content, priority, audience, is_active, created_at
     FROM founder_bulletins
     WHERE is_active = true
       AND (audience = 'all' OR audience = $1)
     ORDER BY created_at DESC`,
    [audience],
  );
}

function evaluateDoctrine(sections: Map<string, DoctrineRow>): CheckResult[] {
  const checks: CheckResult[] = [];

  const missing = REQUIRED_SECTIONS.filter((section) => !sections.has(section));
  if (missing.length > 0) {
    checks.push({
      level: 'FAIL',
      message: `Missing required doctrine sections: ${missing.join(', ')}.`,
    });
  } else {
    checks.push({
      level: 'PASS',
      message: `All required doctrine sections present (${REQUIRED_SECTIONS.length}).`,
    });
  }

  const mission = sections.get('mission');
  const priorities = sections.get('current_priorities');
  const pricing = sections.get('pricing');
  const products = sections.get('products');
  const decisionLog = sections.get('decision_log');
  const doctrine = sections.get('operating_doctrine');
  const authorityModel = sections.get('authority_model');

  checkContains(checks, mission, 'AI Marketing Department framing', /AI Marketing Department|AI-powered departments/i, 'WARN');

  checkContains(checks, priorities, 'SMB focus statement', /SMB|founder-led/i);
  checkContains(checks, priorities, 'enterprise deferral statement', /defer|deferred|not\s+prioritiz(e|ing)\s+enterprise/i);
  checkAbsent(checks, priorities, 'telemetry blackout narrative', /telemetry blackout/i);
  checkAbsent(checks, priorities, 'enterprise prospect research as current priority', /enterprise prospect research/i);

  checkContains(checks, pricing, '$500-750 target range', /\$500\s*[-–]\s*750|500\s*[-–]\s*750/i);
  checkLegacyMentionIsDeprecated(
    checks,
    pricing,
    /\$15\s*[-–]\s*\$50/i,
    /deprecated|must not be used|do not use|legacy/i,
  );
  checkAbsent(checks, pricing, 'legacy web build free/pro/enterprise ladder', new RegExp(`${legacyWebBuildName.toLowerCase()}\\s*:\\s*free tier|pro\\s*\\$29|enterprise custom`, 'i'));

  checkContains(checks, products, 'AI Marketing Department as external product', /AI Marketing Department.*external|external product.*AI Marketing Department/is);
  checkContains(checks, products, 'Pulse internal engine framing', /Pulse.*internal|internal.*Pulse/is);
  checkContains(checks, products, 'web build internal engine framing', /web build.*internal|internal.*web build/is);

  checkContains(checks, decisionLog, 'single external product settlement', /only external product|external product.*only/i);
  checkContains(checks, decisionLog, 'internal engine settlement', /Pulse and the web build engine are internal|internal engines/i);

  checkContains(checks, doctrine, 'one external product doctrine', /ONE external product|only external product/i);
  checkContains(checks, doctrine, 'Slack-first doctrine', /Slack/i);

  checkContains(checks, authorityModel, 'GREEN authority tier', /GREEN/i, 'WARN');
  checkContains(checks, authorityModel, 'YELLOW authority tier', /YELLOW/i, 'WARN');
  checkContains(checks, authorityModel, 'RED authority tier', /RED/i, 'WARN');

  return checks;
}

function evaluateBulletins(bulletins: BulletinRow[]): CheckResult[] {
  const checks: CheckResult[] = [];

  if (bulletins.length === 0) {
    checks.push({ level: 'WARN', message: 'No active founder bulletins found.' });
    return checks;
  }

  checks.push({ level: 'PASS', message: `Active founder bulletins found: ${bulletins.length}.` });

  for (const bulletin of bulletins) {
    for (const rule of FORBIDDEN_BULLETIN_PATTERNS) {
      if (!rule.pattern.test(bulletin.content)) continue;
      checks.push({
        level: 'FAIL',
        message: `Active bulletin conflict (${rule.label}): ${preview(bulletin.content)}`,
      });
    }
  }

  const hasNormalizationBulletin = bulletins.some((b) => /doctrine normalization complete/i.test(b.content));
  if (hasNormalizationBulletin) {
    checks.push({ level: 'PASS', message: 'Doctrine normalization bulletin is active.' });
  } else {
    checks.push({ level: 'WARN', message: 'Doctrine normalization bulletin not found among active bulletins.' });
  }

  return checks;
}

function printReport(doctrineChecks: CheckResult[], bulletinChecks: CheckResult[]): number {
  const checks = [...doctrineChecks, ...bulletinChecks];
  const failCount = checks.filter((c) => c.level === 'FAIL').length;
  const warnCount = checks.filter((c) => c.level === 'WARN').length;
  const passCount = checks.filter((c) => c.level === 'PASS').length;

  console.log('Doctrine Consistency Validation');
  console.log('');

  console.log('Doctrine checks:');
  for (const check of doctrineChecks) {
    console.log(`- [${check.level}] ${check.message}`);
  }

  console.log('');
  console.log('Bulletin checks:');
  for (const check of bulletinChecks) {
    console.log(`- [${check.level}] ${check.message}`);
  }

  console.log('');
  console.log(`Summary: FAIL=${failCount} WARN=${warnCount} PASS=${passCount}`);

  return failCount;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const sections = await loadDoctrine(args.audience);
  const bulletins = await loadActiveBulletins(args.audience);

  const doctrineChecks = evaluateDoctrine(sections);
  const bulletinChecks = evaluateBulletins(bulletins);

  const failCount = printReport(doctrineChecks, bulletinChecks);

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[validate-doctrine-consistency] ${msg}`);
  process.exitCode = 1;
});
