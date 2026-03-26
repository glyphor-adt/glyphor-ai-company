import { systemQuery } from '@glyphor/shared/db';

type AssignmentCode =
  | '0.1'
  | '0.2'
  | '0.3'
  | '0.4'
  | '1.1'
  | '1.2'
  | '1.3'
  | '1.4'
  | '2.1'
  | '3.1'
  | '3.2';

interface AssignmentSeed {
  code: AssignmentCode;
  title: string;
  ownerRole: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  blocking: boolean;
  dependsOn: AssignmentCode[];
  task: string;
  deliverable: string;
  acceptanceTest: string;
}

interface CliArgs {
  apply: boolean;
  replaceExisting: boolean;
}

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const DIRECTIVE_TITLE = 'Web Creation Department - Implementation Directive';

const DIRECTIVE_DESCRIPTION = [
  'Execute the 4-wave web creation operating rollout with strict dependency ordering.',
  'This directive is decomposed into exact assignments with single owner, deliverable, and acceptance test.',
  'Wave sequence: Wave 0 infrastructure -> Wave 1 skill/runtime wiring -> Wave 2 end-to-end integration test -> Wave 3 post-ship learning capture.',
].join(' ');

const ASSIGNMENTS: AssignmentSeed[] = [
  {
    code: '0.1',
    title: 'Create web-template-react repo scaffold',
    ownerRole: 'cto',
    priority: 'urgent',
    blocking: true,
    dependsOn: [],
    task: 'Create glyphor-adt/web-template-react from the react_spa scaffold baseline with strict TypeScript, Tailwind v4, Prism tokens, and required file contract. Ensure clean starter build/lint/typecheck.',
    deliverable: 'Repository glyphor-adt/web-template-react with required structure, style system files, and baseline app shell.',
    acceptanceTest: 'Clone repo -> npm install && npm run build passes; npm run lint passes; npx tsc --noEmit passes.',
  },
  {
    code: '0.2',
    title: 'Author ux-engineer Codex skill',
    ownerRole: 'cto',
    priority: 'urgent',
    blocking: true,
    dependsOn: ['0.1'],
    task: 'Create .codex/skills/ux-engineer/SKILL.md in web-template-react with design rules, implementation constraints, file contract, media handling, and quality enforcement from the legacy web build UX Engineer instruction.',
    deliverable: 'Complete ux-engineer SKILL.md in template repo with enforceable rules and execution contract.',
    acceptanceTest: 'SKILL.md includes banned fonts/layouts, token-first colors, interaction budget minimums, image manifest requirements, and design_plan requirement.',
  },
  {
    code: '0.3',
    title: 'Verify scheduler credentials and IAM',
    ownerRole: 'devops-engineer',
    priority: 'urgent',
    blocking: true,
    dependsOn: [],
    task: 'Verify and mount GITHUB_TOKEN, VERCEL_TOKEN, PULSE_SERVICE_KEY, OPENAI_API_KEY, CLOUDFLARE_API_TOKEN on glyphor-scheduler. Validate API connectivity and required IAM roles.',
    deliverable: 'All required secrets exist in Secret Manager, mounted on glyphor-scheduler, and externally validated via health/API checks.',
    acceptanceTest: 'inspect_cloud_run_service confirms mounted secrets; each credential test returns valid response.',
  },
  {
    code: '0.4',
    title: 'Deploy Cloudflare preview worker',
    ownerRole: 'devops-engineer',
    priority: 'high',
    blocking: false,
    dependsOn: ['0.3'],
    task: 'Deploy workers/preview implementation to Cloudflare Workers and configure wildcard DNS for *.preview.glyphor.ai preview mapping and proxy behavior.',
    deliverable: 'preview-worker deployment + wildcard DNS + mapping endpoint working for branded preview hostnames.',
    acceptanceTest: 'Register test.preview.glyphor.ai mapping to a Vercel URL and verify branded URL resolves and proxies correctly.',
  },
  {
    code: '1.1',
    title: 'Update advanced-web-creation skill',
    ownerRole: 'vp-design',
    priority: 'high',
    blocking: true,
    dependsOn: ['0.1', '0.2'],
    task: 'Update advanced-web-creation skill with mandatory pipeline sequence, detailed brief requirements, Codex invocation pattern, and normalize_design_brief in tools_granted.',
    deliverable: 'Updated advanced-web-creation skill source and synced DB skill row.',
    acceptanceTest: 'Skill contains full mandatory sequence, brief schema, Codex invocation details, and tools_granted includes normalize_design_brief.',
  },
  {
    code: '1.2',
    title: 'Update elite-design-review skill',
    ownerRole: 'design-critic',
    priority: 'high',
    blocking: true,
    dependsOn: [],
    task: 'Update elite-design-review skill with automated pre-check gates, 100-point rubric criteria, structured feedback contract, and post-ship learning capture loop.',
    deliverable: 'Updated elite-design-review skill source and synced DB skill row.',
    acceptanceTest: 'Skill includes pre-check gates, explicit rubric scoring criteria, structured feedback format, and learning loop instructions.',
  },
  {
    code: '1.3',
    title: 'Add Pulse media routing to content-creation',
    ownerRole: 'content-creator',
    priority: 'high',
    blocking: false,
    dependsOn: [],
    task: 'Update content-creation skill with web-build image/video manifest routing table and post-generation commit rules for public/images and public/videos.',
    deliverable: 'Updated content-creation skill with explicit type->tool routing and repo commit behavior.',
    acceptanceTest: 'Skill includes routing matrix and explicit instruction to commit generated assets so preview auto-redeploys.',
  },
  {
    code: '1.4',
    title: 'Wire Codex MCP runtime access for Ethan',
    ownerRole: 'cto',
    priority: 'urgent',
    blocking: true,
    dependsOn: ['0.3'],
    task: 'Install Codex CLI in scheduler runtime, register mcp_Codex server, expose codex/codex-reply, and grant access to frontend-engineer.',
    deliverable: 'Codex tools callable by frontend-engineer from agent runtime with OPENAI_API_KEY-backed auth.',
    acceptanceTest: 'Frontend engineer executes codex() against web-template-react branch and produces PR that passes npm run build.',
  },
  {
    code: '2.1',
    title: 'Run end-to-end coming-soon build validation',
    ownerRole: 'chief-of-staff',
    priority: 'urgent',
    blocking: false,
    dependsOn: ['0.1', '0.2', '0.3', '1.1', '1.2', '1.4'],
    task: 'Orchestrate complete pipeline test: Mia+Leo brief/IA, Ethan Codex build + preview checks, Tyler Pulse assets, Sofia review loop to 90+, Jordan branded preview mapping.',
    deliverable: 'Live coming-soon.preview.glyphor.ai preview with 90+ review score and passing technical gates.',
    acceptanceTest: 'Zero AI-smell flags, WCAG AA pass, responsive at 4 breakpoints, Pulse assets integrated, PR branch builds clean.',
  },
  {
    code: '3.1',
    title: 'Persist reference patterns after ship',
    ownerRole: 'design-critic',
    priority: 'normal',
    blocking: false,
    dependsOn: ['2.1'],
    task: 'Save post-ship reference pattern memory entries and update ux-engineer proven patterns/common deductions in template skill.',
    deliverable: 'Memory entries + template repo PR updating ux-engineer learning sections.',
    acceptanceTest: 'ux-engineer skill has at least one proven pattern and one common deduction entry from the shipped build.',
  },
  {
    code: '3.2',
    title: 'Publish web creation postmortem v1',
    ownerRole: 'cto',
    priority: 'normal',
    blocking: false,
    dependsOn: ['2.1'],
    task: 'Document credential/config issues, Codex heal cycles, Pulse routing fidelity, template fixes, skill adjustments, elapsed time, and total cost as web_creation_postmortem_v1.',
    deliverable: 'Complete postmortem memory entry for next-run optimization.',
    acceptanceTest: 'web_creation_postmortem_v1 exists with all required sections populated.',
  },
];

function parseArgs(argv: string[]): CliArgs {
  return {
    apply: argv.includes('--apply'),
    replaceExisting: argv.includes('--replace-existing'),
  };
}

function renderTaskBody(seed: AssignmentSeed): string {
  return [
    `[${seed.code}] ${seed.title}`,
    `Priority: ${seed.priority}${seed.blocking ? ' (BLOCKING)' : ''}`,
    '',
    'Task:',
    seed.task,
    '',
    'Deliverable:',
    seed.deliverable,
    '',
    'Acceptance test:',
    seed.acceptanceTest,
  ].join('\n');
}

async function getOrCreateDirective(): Promise<string> {
  const existing = await systemQuery<{ id: string }>(
    `SELECT id
       FROM founder_directives
      WHERE tenant_id = $1
        AND title = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [TENANT_ID, DIRECTIVE_TITLE],
  );

  if (existing.length > 0) {
    return existing[0].id;
  }

  const targetAgents = Array.from(new Set(ASSIGNMENTS.map((a) => a.ownerRole)));
  const created = await systemQuery<{ id: string }>(
    `INSERT INTO founder_directives (
       tenant_id,
       created_by,
       title,
       description,
       priority,
       category,
       target_agents,
       status,
       source
     ) VALUES (
       $1, 'kristina', $2, $3, 'critical', 'operations', $4::text[], 'active', 'founder'
     ) RETURNING id`,
    [TENANT_ID, DIRECTIVE_TITLE, DIRECTIVE_DESCRIPTION, targetAgents],
  );

  return created[0].id;
}

async function seedAssignments(directiveId: string, replaceExisting: boolean): Promise<void> {
  const existing = await systemQuery<{ id: string }>(
    `SELECT id
       FROM work_assignments
      WHERE tenant_id = $1
        AND directive_id = $2`,
    [TENANT_ID, directiveId],
  );

  if (existing.length > 0 && !replaceExisting) {
    throw new Error(
      `Directive already has ${existing.length} assignments. Re-run with --replace-existing to recreate this decomposition.`,
    );
  }

  if (existing.length > 0 && replaceExisting) {
    await systemQuery(
      `DELETE FROM work_assignments
       WHERE tenant_id = $1
         AND directive_id = $2`,
      [TENANT_ID, directiveId],
    );
  }

  const assignmentIdsByCode = new Map<AssignmentCode, string>();

  for (const [index, seed] of ASSIGNMENTS.entries()) {
    const inserted = await systemQuery<{ id: string }>(
      `INSERT INTO work_assignments (
         tenant_id,
         directive_id,
         assigned_to,
         assigned_by,
         task_description,
         task_type,
         expected_output,
         priority,
         sequence_order,
         assignment_type,
         status
       ) VALUES (
         $1, $2, $3, 'chief-of-staff', $4, 'on_demand', $5, $6, $7, 'executive_outcome', 'pending'
       ) RETURNING id`,
      [
        TENANT_ID,
        directiveId,
        seed.ownerRole,
        renderTaskBody(seed),
        `${seed.deliverable}\n\nAcceptance: ${seed.acceptanceTest}`,
        seed.priority,
        index,
      ],
    );

    assignmentIdsByCode.set(seed.code, inserted[0].id);
  }

  for (const seed of ASSIGNMENTS) {
    if (seed.dependsOn.length === 0) continue;
    const assignmentId = assignmentIdsByCode.get(seed.code);
    if (!assignmentId) continue;

    const dependencyIds = seed.dependsOn
      .map((code) => assignmentIdsByCode.get(code))
      .filter((value): value is string => Boolean(value));

    if (dependencyIds.length === 0) continue;

    await systemQuery(
      `UPDATE work_assignments
          SET depends_on = $1::uuid[]
        WHERE tenant_id = $2
          AND id = $3`,
      [dependencyIds, TENANT_ID, assignmentId],
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.apply) {
    process.stdout.write(
      [
        'Dry run only. No DB changes were applied.',
        `Directive title: ${DIRECTIVE_TITLE}`,
        `Assignments to seed: ${ASSIGNMENTS.length}`,
        'Run with --apply to write founder_directives/work_assignments.',
      ].join('\n') + '\n',
    );
    return;
  }

  const directiveId = await getOrCreateDirective();
  await seedAssignments(directiveId, args.replaceExisting);

  process.stdout.write(
    [
      'Web creation implementation directive dispatched.',
      `directive_id=${directiveId}`,
      `assignments_seeded=${ASSIGNMENTS.length}`,
      'Next step: Chief of Staff can dispatch assignments by dependency readiness.',
    ].join('\n') + '\n',
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
