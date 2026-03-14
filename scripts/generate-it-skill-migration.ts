import fs from 'node:fs';
import path from 'node:path';

interface ParsedSkill {
  slug: string;
  name: string;
  category: string;
  description: string;
  methodology: string;
  tools_granted: string[];
  version: number;
  holders: string[];
}

interface TaskMapping {
  task_regex: string;
  skill_slug: string;
  priority: number;
}

const IT_SKILL_FILES = [
  'skills/engineering/code-review.md',
  'skills/engineering/incident-response.md',
  'skills/engineering/platform-monitoring.md',
  'skills/engineering/tech-spec-writing.md',
  'skills/engineering/quality-assurance.md',
  'skills/engineering/infrastructure-ops.md',
  'skills/engineering/frontend-development.md',
  'skills/operations/access-management.md',
  'skills/operations/tenant-administration.md',
] as const;

const TASK_MAPPINGS: TaskMapping[] = [
  { task_regex: '(incident|outage|downtime|sev[0-4]|p[0-3]|rollback|service down|major outage)', skill_slug: 'incident-response', priority: 20 },
  { task_regex: '(platform health|health check|uptime|latency|slo|sli|availability|service status|monitor)', skill_slug: 'platform-monitoring', priority: 16 },
  { task_regex: '(tech spec|technical spec|architecture spec|rfc|design doc|implementation plan)', skill_slug: 'tech-spec-writing', priority: 15 },
  { task_regex: '(code review|review pr|pull request review|pr review|review diff|merge readiness)', skill_slug: 'code-review', priority: 18 },
  { task_regex: '(qa|quality assurance|test plan|regression|test coverage|acceptance criteria)', skill_slug: 'quality-assurance', priority: 15 },
  { task_regex: '(infra ops|infrastructure ops|cloud run scaling|cloud tasks|deployment pipeline|cicd|ci/cd|secret manager)', skill_slug: 'infrastructure-ops', priority: 14 },
  { task_regex: '(frontend implementation|frontend development|ui implementation|component build|react component|next\\.js ui)', skill_slug: 'frontend-development', priority: 14 },
  { task_regex: '(access audit|permission review|tool grant|least privilege|iam role|service account access)', skill_slug: 'access-management', priority: 17 },
  { task_regex: '(entra|m365|microsoft 365|tenant admin|license assignment|directory role|group membership)', skill_slug: 'tenant-administration', priority: 17 },
];

function parseSkillFile(repoRoot: string, filePath: string): ParsedSkill {
  const absPath = path.join(repoRoot, filePath);
  const raw = fs.readFileSync(absPath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    throw new Error(`Invalid frontmatter format: ${filePath}`);
  }

  const frontmatter = match[1];
  const body = match[2].trim();
  const frontmatterObj: Record<string, string> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontmatterObj[key] = value;
  }

  const parsed: ParsedSkill = {
    slug: frontmatterObj.slug,
    name: frontmatterObj.name,
    category: frontmatterObj.category,
    description: frontmatterObj.description,
    methodology: body,
    tools_granted: (frontmatterObj.tools_granted || '').split(',').map((s) => s.trim()).filter(Boolean),
    version: Number(frontmatterObj.version || '1'),
    holders: (frontmatterObj.holders || '').split(',').map((s) => s.trim()).filter(Boolean),
  };

  if (!parsed.slug || !parsed.name || !parsed.category || !parsed.description) {
    throw new Error(`Missing required frontmatter fields in ${filePath}`);
  }

  return parsed;
}

function utcTimestampForMigration(date: Date): string {
  const y = date.getUTCFullYear().toString();
  const mo = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `${y}${mo}${d}${h}${mi}${s}`;
}

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function buildMigrationSql(skills: ParsedSkill[]): string {
  const skillsPayload = skills.map(({ slug, name, category, description, methodology, tools_granted, version }) => ({
    slug,
    name,
    category,
    description,
    methodology,
    tools_granted,
    version,
  }));

  const holdersPayload = skills.flatMap(({ slug, holders }) => holders.map((agent_role) => ({ agent_role, skill_slug: slug })));

  return `-- Sync IT skill playbooks (engineering + operations) from markdown source files.
-- Source of truth: skills/engineering/*.md and skills/operations/*.md

BEGIN;

WITH skill_payload AS (
  SELECT *
  FROM jsonb_to_recordset($json$${JSON.stringify(skillsPayload)}$json$::jsonb)
    AS x(
      slug text,
      name text,
      category text,
      description text,
      methodology text,
      tools_granted text[],
      version int
    )
)
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
SELECT slug, name, category, description, methodology, tools_granted, version
FROM skill_payload
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

WITH holder_payload AS (
  SELECT *
  FROM jsonb_to_recordset($json$${JSON.stringify(holdersPayload)}$json$::jsonb)
    AS x(agent_role text, skill_slug text)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM holder_payload
),
existing_target AS (
  SELECT s.id AS skill_id, s.slug
  FROM skills s
  JOIN target_slugs t ON t.skill_slug = s.slug
)
DELETE FROM agent_skills ags
USING existing_target et
WHERE ags.skill_id = et.skill_id
  AND NOT EXISTS (
    SELECT 1
    FROM holder_payload hp
    WHERE hp.agent_role = ags.agent_role
      AND hp.skill_slug = et.slug
  );

WITH holder_payload AS (
  SELECT *
  FROM jsonb_to_recordset($json$${JSON.stringify(holdersPayload)}$json$::jsonb)
    AS x(agent_role text, skill_slug text)
)
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT hp.agent_role, s.id, 'learning'
FROM holder_payload hp
JOIN skills s ON s.slug = hp.skill_slug
JOIN company_agents ca ON ca.role = hp.agent_role
ON CONFLICT (agent_role, skill_id) DO NOTHING;

WITH mapping_payload AS (
  SELECT *
  FROM jsonb_to_recordset($json$${JSON.stringify(TASK_MAPPINGS)}$json$::jsonb)
    AS x(task_regex text, skill_slug text, priority int)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM mapping_payload
)
DELETE FROM task_skill_map t
USING target_slugs s
WHERE t.skill_slug = s.skill_slug;

WITH mapping_payload AS (
  SELECT *
  FROM jsonb_to_recordset($json$${JSON.stringify(TASK_MAPPINGS)}$json$::jsonb)
    AS x(task_regex text, skill_slug text, priority int)
)
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
SELECT task_regex, skill_slug, priority
FROM mapping_payload;

COMMIT;
`;
}

function main(): void {
  const args = process.argv.slice(2);
  const repoRoot = process.cwd();
  const explicitOut = readArg(args, '--out');

  const outFile = explicitOut
    ? explicitOut
    : path.join('db', 'migrations', `${utcTimestampForMigration(new Date())}_sync_it_skill_playbooks.sql`);

  const parsed = IT_SKILL_FILES.map((f) => parseSkillFile(repoRoot, f));
  const sql = buildMigrationSql(parsed);

  const outAbs = path.join(repoRoot, outFile);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, sql, 'utf8');

  process.stdout.write(`Generated migration: ${outFile}\n`);
  process.stdout.write(`Skills: ${parsed.length}\n`);
  process.stdout.write(`Mappings: ${TASK_MAPPINGS.length}\n`);
}

main();
