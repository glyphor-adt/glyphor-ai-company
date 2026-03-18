/**
 * scripts/audit/audit-fleet.ts
 *
 * Runs auditAgent() for every active agent and produces a consolidated fleet report.
 * Usage:  npx tsx scripts/audit/audit-fleet.ts
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { systemQuery } from '@glyphor/shared/db';
import { auditAgent, type AgentAuditReport } from './audit-agent.js';

// ── Fleet report types ─────────────────────────────────────

interface DbOnlyAgent {
  role: string;
  displayName: string;
  department: string;
  reportsTo: string;
  hasSkills: boolean;
  skillCount: number;
  recentAssignments: number;
  recentMessages: number;
  recommendation: 'deactivate' | 'build_runner' | 'defer';
  reason: string;
}

interface FleetAuditReport {
  timestamp: string;
  agentCount: number;
  agents: AgentAuditReport[];

  totalTokenBudget: number;

  healthSummary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    noData: number;
  };

  criticalIssues: Array<{ agent: string } & AgentAuditReport['recommendations'][0]>;
  bloatedBriefs: Array<{ role: string; tokens: number }>;
  zeroSkillAgents: string[];
  runnerMismatches: Array<{ role: string; factories: number }>;
  temperatureOutliers: Array<{ role: string; temp: number }>;
  unroutedTaskTypes: Array<{ agent: string; task: string }>;
  toolHeavyAgents: Array<{ role: string; factories: number; estimated: number }>;
  crossDomainSkillIssues: Array<{ role: string; skills: string[] }>;
  allGhostToolRefs: Array<{ agent: string; tool: string }>;
  turnLimitIssues: Array<{ role: string; maxTurnsHits: number; totalRuns: number; rate: number }>;
  dbOnlyAgents: DbOnlyAgent[];
}

// ── Runner agent directories ───────────────────────────────

const ROOT = path.resolve(process.cwd());
const AGENTS_SRC = path.join(ROOT, 'packages', 'agents', 'src');

const RUNNER_AGENT_DIRS = new Set(
  readdirSync(AGENTS_SRC, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'shared')
    .map(d => d.name),
);

// ── DB-only agent analysis ─────────────────────────────────

async function analyzeDbOnlyAgents(): Promise<DbOnlyAgent[]> {
  const runnerRoles = [...RUNNER_AGENT_DIRS];
  const placeholders = runnerRoles.map((_, i) => `$${i + 1}`).join(',');

  const rows = await systemQuery<{
    role: string; display_name: string; department: string; reports_to: string;
  }>(
    `SELECT role, display_name, department, reports_to
     FROM company_agents
     WHERE status = 'active' AND role NOT IN (${placeholders})`,
    runnerRoles,
  );

  const results: DbOnlyAgent[] = [];

  for (const agent of rows) {
    // Check skill count
    const [{ count: skillCount }] = await systemQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM agent_skills WHERE agent_role = $1`,
      [agent.role],
    ).catch(() => [{ count: 0 }]);

    // Check recent assignments
    const [{ count: recentAssignments }] = await systemQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM work_assignments
       WHERE assigned_to = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [agent.role],
    );

    // Check recent messages
    const [{ count: recentMessages }] = await systemQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM agent_messages
       WHERE to_agent = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [agent.role],
    );

    let recommendation: 'deactivate' | 'build_runner' | 'defer';
    let reason: string;

    if (recentAssignments > 0 || recentMessages > 0) {
      recommendation = 'build_runner';
      reason = `Active references: ${recentAssignments} assignments, ${recentMessages} messages in 30 days.`;
    } else if (agent.department === 'Customer Success') {
      recommendation = 'deactivate';
      reason = 'Customer Success department retired.';
    } else if (skillCount > 0) {
      recommendation = 'defer';
      reason = `Has ${skillCount} skills but no recent activity. May be needed when executive becomes orchestrator.`;
    } else {
      recommendation = 'deactivate';
      reason = 'No skills, no recent activity, no runner.';
    }

    results.push({
      role: agent.role,
      displayName: agent.display_name,
      department: agent.department ?? 'Unknown',
      reportsTo: agent.reports_to ?? 'Unknown',
      hasSkills: skillCount > 0,
      skillCount,
      recentAssignments,
      recentMessages,
      recommendation,
      reason,
    });
  }

  return results;
}

// ── Fleet audit ────────────────────────────────────────────

async function auditFleet(): Promise<FleetAuditReport> {
  // Get all active agent roles that have runners
  const activeAgents = await systemQuery<{ role: string }>(
    `SELECT role FROM company_agents WHERE status = 'active' ORDER BY role`,
  );

  const runnerAgents = activeAgents.filter(a => RUNNER_AGENT_DIRS.has(a.role));

  console.log(`\n🔍 Fleet audit starting for ${runnerAgents.length} runner agents...\n`);

  const reports: AgentAuditReport[] = [];
  for (const agent of runnerAgents) {
    try {
      process.stdout.write(`  Auditing ${agent.role}...`);
      const report = await auditAgent(agent.role);
      reports.push(report);
      const p0 = report.recommendations.filter(r => r.priority === 'P0').length;
      console.log(` ✅ ${p0 > 0 ? `(${p0} P0!)` : ''}`);
    } catch (err) {
      console.log(` ❌ ${(err as Error).message}`);
    }
  }

  console.log(`\n📊 Analyzing DB-only agents...`);
  const dbOnlyAgents = await analyzeDbOnlyAgents();

  // Assemble fleet report
  const fleetReport: FleetAuditReport = {
    timestamp: new Date().toISOString(),
    agentCount: reports.length,
    agents: reports,

    totalTokenBudget: reports.reduce((sum, r) =>
      sum + r.brief.tokenCount + r.systemPrompt.tokenCount + r.skills.totalTokens, 0),

    healthSummary: {
      healthy: reports.filter(r => {
        const rate = r.runs.last30Days.completed / Math.max(r.runs.last30Days.total, 1);
        return r.runs.last30Days.total > 0 && rate > 0.8;
      }).length,
      degraded: reports.filter(r => {
        const rate = r.runs.last30Days.completed / Math.max(r.runs.last30Days.total, 1);
        return r.runs.last30Days.total > 0 && rate > 0.5 && rate <= 0.8;
      }).length,
      unhealthy: reports.filter(r => {
        const rate = r.runs.last30Days.completed / Math.max(r.runs.last30Days.total, 1);
        return r.runs.last30Days.total > 0 && rate <= 0.5;
      }).length,
      noData: reports.filter(r => r.runs.last30Days.total === 0).length,
    },

    criticalIssues: reports.flatMap(r =>
      r.recommendations
        .filter(rec => rec.priority === 'P0')
        .map(rec => ({ agent: r.role, ...rec })),
    ),

    bloatedBriefs: reports
      .filter(r => r.brief.tokenCount > 1200)
      .map(r => ({ role: r.role, tokens: r.brief.tokenCount }))
      .sort((a, b) => b.tokens - a.tokens),

    zeroSkillAgents: reports
      .filter(r => r.skills.assigned.length === 0)
      .map(r => r.role),

    runnerMismatches: reports
      .filter(r => r.config.runnerMismatch)
      .map(r => ({ role: r.role, factories: r.tools.factoryCount })),

    temperatureOutliers: reports
      .filter(r => r.config.temperatureOutlier)
      .map(r => ({ role: r.role, temp: r.config.temperature })),

    unroutedTaskTypes: reports.flatMap(r =>
      r.taskRouting.uncoveredTaskTypes.map(task => ({ agent: r.role, task })),
    ),

    toolHeavyAgents: reports
      .filter(r => r.tools.factoryCount > 15)
      .map(r => ({ role: r.role, factories: r.tools.factoryCount, estimated: r.tools.estimatedToolCount }))
      .sort((a, b) => b.factories - a.factories),

    crossDomainSkillIssues: reports
      .filter(r => r.skills.crossDomainSkills.length > 0)
      .map(r => ({ role: r.role, skills: r.skills.crossDomainSkills })),

    allGhostToolRefs: reports
      .filter(r => r.skills.ghostToolRefs.length > 0)
      .flatMap(r => r.skills.ghostToolRefs.map(tool => ({ agent: r.role, tool }))),

    turnLimitIssues: reports
      .filter(r => r.runs.last30Days.total > 0 &&
        r.runs.last30Days.maxTurnsReached > r.runs.last30Days.total * 0.15)
      .map(r => ({
        role: r.role,
        maxTurnsHits: r.runs.last30Days.maxTurnsReached,
        totalRuns: r.runs.last30Days.total,
        rate: Math.round(r.runs.last30Days.maxTurnsReached / Math.max(r.runs.last30Days.total, 1) * 100),
      })),

    dbOnlyAgents,
  };

  // Write reports
  const outputDir = path.join(ROOT, 'audit-reports');
  await mkdir(outputDir, { recursive: true });

  const dateStr = new Date().toISOString().split('T')[0];
  await writeFile(
    path.join(outputDir, `fleet-report-${dateStr}.json`),
    JSON.stringify(fleetReport, null, 2),
  );

  for (const report of reports) {
    await writeFile(
      path.join(outputDir, `${report.role}-audit.json`),
      JSON.stringify(report, null, 2),
    );
  }

  // Print summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  FLEET AUDIT SUMMARY — ${dateStr}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Agents audited:     ${reports.length}`);
  console.log(`  Total token budget: ${fleetReport.totalTokenBudget.toLocaleString()}`);
  console.log(`  Health: ${fleetReport.healthSummary.healthy} healthy, ${fleetReport.healthSummary.degraded} degraded, ${fleetReport.healthSummary.unhealthy} unhealthy, ${fleetReport.healthSummary.noData} no-data`);
  console.log(`\n  🔴 P0 Critical Issues: ${fleetReport.criticalIssues.length}`);
  for (const issue of fleetReport.criticalIssues) {
    console.log(`     [${issue.agent}] ${issue.description}`);
  }
  console.log(`\n  📝 Bloated briefs (>1200 tokens): ${fleetReport.bloatedBriefs.length}`);
  for (const b of fleetReport.bloatedBriefs.slice(0, 5)) {
    console.log(`     ${b.role}: ${b.tokens} tokens`);
  }
  console.log(`  ⚠️  Zero-skill agents: ${fleetReport.zeroSkillAgents.join(', ') || 'none'}`);
  console.log(`  🔀 Runner mismatches: ${fleetReport.runnerMismatches.length}`);
  console.log(`  🌡️  Temperature outliers: ${fleetReport.temperatureOutliers.length}`);
  console.log(`  🛣️  Unrouted task types: ${fleetReport.unroutedTaskTypes.length}`);
  console.log(`  🔧 Tool-heavy agents (>15 factories): ${fleetReport.toolHeavyAgents.length}`);
  console.log(`  🔗 Cross-domain skill issues: ${fleetReport.crossDomainSkillIssues.length}`);
  console.log(`  👻 Ghost tool references: ${fleetReport.allGhostToolRefs.length}`);
  console.log(`  ⏱️  Turn limit issues: ${fleetReport.turnLimitIssues.length}`);
  console.log(`  💤 DB-only agents: ${dbOnlyAgents.length} (${dbOnlyAgents.filter(a => a.recommendation === 'deactivate').length} deactivate, ${dbOnlyAgents.filter(a => a.recommendation === 'build_runner').length} build, ${dbOnlyAgents.filter(a => a.recommendation === 'defer').length} defer)`);
  console.log(`\n  Reports saved to: audit-reports/`);

  return fleetReport;
}

// ── CLI ────────────────────────────────────────────────────

auditFleet().catch(err => { console.error(err); process.exit(1); });
