/**
 * CMO GTM / eval audit queries — run all and return full results.
 * Run: powershell -ExecutionPolicy Bypass -File scripts/run-with-local-db-proxy.ps1 -Run npx tsx scripts/_query-cmo-gtm-eval-audit.ts
 */
import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const separator = '\n' + '='.repeat(80) + '\n';

  console.log(separator + '1. GTM gate success_rate for CMO (agent_runs, 60 days)' + separator);
  const q1 = await systemQuery<Record<string, unknown>>(
    `SELECT 
      AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END) AS gtm_success_rate,
      COUNT(*) AS total_runs,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed
    FROM agent_runs
    WHERE agent_id = 'cmo'
    AND created_at > NOW() - INTERVAL '60 days'`,
  );
  console.log(JSON.stringify(q1, null, 2));

  console.log(separator + '2. Performance_score 0.6 — assignment_evaluations by evaluator_type for CMO' + separator);
  const q2 = await systemQuery<Record<string, unknown>>(
    `SELECT 
      evaluator_type,
      COUNT(*) AS eval_count,
      ROUND(AVG(score_normalized) * 100, 1) AS avg_score,
      MIN(evaluated_at) AS oldest_eval,
      MAX(evaluated_at) AS newest_eval
    FROM assignment_evaluations ae
    JOIN work_assignments wa ON wa.id = ae.assignment_id
    WHERE wa.assigned_to = 'cmo'
    GROUP BY evaluator_type
    ORDER BY evaluator_type`,
  );
  console.log(JSON.stringify(q2, null, 2));

  console.log(separator + '3. CMO assignments: assignment_type, status, with_eval' + separator);
  const q3 = await systemQuery<Record<string, unknown>>(
    `SELECT 
      wa.assignment_type,
      wa.status,
      COUNT(*) AS count,
      COUNT(ae.id) AS with_eval
    FROM work_assignments wa
    LEFT JOIN assignment_evaluations ae ON ae.assignment_id = wa.id
    WHERE wa.assigned_to = 'cmo'
    GROUP BY wa.assignment_type, wa.status
    ORDER BY count DESC`,
  );
  console.log(JSON.stringify(q3, null, 2));

  console.log(separator + '4. Knowledge eval HARD_FAIL for CMO — when, reasoning preview' + separator);
  const q4 = await systemQuery<Record<string, unknown>>(
    `SELECT 
      aes.scenario_name,
      aer.score,
      aer.run_date,
      LEFT(aer.reasoning, 200) AS reasoning_preview
    FROM agent_eval_results aer
    JOIN agent_eval_scenarios aes ON aes.id = aer.scenario_id
    WHERE aes.agent_role = 'cmo'
    AND aer.score = 'HARD_FAIL'
    ORDER BY aer.run_date DESC`,
  );
  console.log(JSON.stringify(q4, null, 2));

  console.log(separator + '5. Open P0s for CMO (fleet_findings)' + separator);
  const q5 = await systemQuery<Record<string, unknown>>(
    `SELECT finding_type, description, detected_at, severity
    FROM fleet_findings
    WHERE agent_id = 'cmo'
    AND resolved_at IS NULL
    ORDER BY severity, detected_at DESC`,
  );
  console.log(JSON.stringify(q5, null, 2));

  console.log(separator + '6. Content-creator performance_score 0.57 — eval breakdown' + separator);
  const q6 = await systemQuery<Record<string, unknown>>(
    `SELECT 
      evaluator_type,
      COUNT(*) AS eval_count,
      ROUND(AVG(score_normalized) * 100, 1) AS avg_score
    FROM assignment_evaluations ae
    JOIN work_assignments wa ON wa.id = ae.assignment_id
    WHERE wa.assigned_to = 'content-creator'
    GROUP BY evaluator_type`,
  );
  console.log(JSON.stringify(q6, null, 2));

  console.log(separator + '7. GTM agents: performance_score, updated_at' + separator);
  const q7 = await systemQuery<Record<string, unknown>>(
    `SELECT role, display_name, performance_score, updated_at
    FROM company_agents
    WHERE role IN (
      'cmo','content-creator','seo-analyst',
      'social-media-manager','chief-of-staff'
    )
    ORDER BY role`,
  );
  console.log(JSON.stringify(q7, null, 2));

  console.log(separator + '8. EvalFleetGrid data source for CMO (fixed: fleet_findings in subquery)' + separator);
  const q8 = await systemQuery<Record<string, unknown>>(
    `SELECT
      ca.role AS id,
      ca.display_name AS name,
      ca.department,
      ca.performance_score,
      apv.version AS prompt_version,
      apv.source AS prompt_source,
      AVG(ae_exec.score_normalized) AS exec_quality,
      AVG(ae_team.score_normalized) AS team_quality,
      AVG(ae_cos.score_normalized) AS cos_quality,
      AVG(ae_con.score_normalized) AS constitutional_score,
      AVG(CASE WHEN ar.status = 'completed' THEN 1.0 ELSE 0.0 END) AS success_rate,
      COALESCE(ff.open_p0s, 0) AS open_p0s
    FROM company_agents ca
    LEFT JOIN (
      SELECT DISTINCT ON (agent_id) agent_id, version, source
      FROM agent_prompt_versions
      WHERE deployed_at IS NOT NULL AND retired_at IS NULL
      ORDER BY agent_id, deployed_at DESC
    ) apv ON apv.agent_id = ca.role
    LEFT JOIN work_assignments wa ON wa.assigned_to = ca.role
    LEFT JOIN assignment_evaluations ae_exec ON ae_exec.assignment_id = wa.id AND ae_exec.evaluator_type = 'executive'
    LEFT JOIN assignment_evaluations ae_team ON ae_team.assignment_id = wa.id AND ae_team.evaluator_type = 'team'
    LEFT JOIN assignment_evaluations ae_cos ON ae_cos.assignment_id = wa.id AND ae_cos.evaluator_type = 'cos'
    LEFT JOIN assignment_evaluations ae_con ON ae_con.assignment_id = wa.id AND ae_con.evaluator_type = 'constitutional'
    LEFT JOIN agent_runs ar ON ar.agent_id = ca.role
    LEFT JOIN (
      SELECT agent_id,
        COUNT(*) FILTER (WHERE severity = 'P0' AND resolved_at IS NULL) AS open_p0s,
        COUNT(*) FILTER (WHERE severity = 'P1' AND resolved_at IS NULL) AS open_p1s
      FROM fleet_findings
      GROUP BY agent_id
    ) ff ON ff.agent_id = ca.role
    WHERE ca.role = 'cmo'
    GROUP BY ca.role, ca.display_name, ca.department, ca.performance_score, apv.version, apv.source, ff.open_p0s`,
  );
  console.log(JSON.stringify(q8, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
