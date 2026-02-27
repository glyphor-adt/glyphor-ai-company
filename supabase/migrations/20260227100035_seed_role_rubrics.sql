-- ═══════════════════════════════════════════════════════════════════
-- Migration: Seed Role Rubrics
-- Date: 2026-03-28
--
-- Seeds the role_rubrics table with default rubrics for common task
-- types, plus role-specific rubrics for orchestrator roles.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- DEFAULT RUBRIC: Applies to any role/task without a specific rubric
-- ───────────────────────────────────────────────────────────────────

INSERT INTO role_rubrics (role, task_type, dimensions, passing_score, excellence_score)
VALUES (
  '_default', '_default', '
  [
    {
      "name": "task_completion",
      "weight": 0.30,
      "levels": {
        "1_novice": "Task requirements not met or largely ignored",
        "2_developing": "Partial completion with significant gaps",
        "3_competent": "Core requirements met with minor omissions",
        "4_expert": "All requirements met thoroughly",
        "5_master": "Requirements exceeded with proactive additions"
      }
    },
    {
      "name": "reasoning_quality",
      "weight": 0.25,
      "levels": {
        "1_novice": "No visible reasoning; conclusions appear arbitrary",
        "2_developing": "Surface-level reasoning with logical gaps",
        "3_competent": "Sound reasoning with clear logic chain",
        "4_expert": "Deep analysis considering multiple perspectives",
        "5_master": "Exceptional reasoning with novel insights and edge-case awareness"
      }
    },
    {
      "name": "tool_usage",
      "weight": 0.20,
      "levels": {
        "1_novice": "Tools not used or used incorrectly",
        "2_developing": "Basic tool usage with unnecessary calls or missed opportunities",
        "3_competent": "Appropriate tool selection and usage",
        "4_expert": "Efficient tool chains with good error handling",
        "5_master": "Optimal tool orchestration; creative tool combinations"
      }
    },
    {
      "name": "communication",
      "weight": 0.15,
      "levels": {
        "1_novice": "Output unclear or poorly structured",
        "2_developing": "Understandable but verbose or disorganized",
        "3_competent": "Clear, well-structured communication",
        "4_expert": "Concise, actionable, tailored to audience",
        "5_master": "Exceptional clarity with strategic framing"
      }
    },
    {
      "name": "cost_efficiency",
      "weight": 0.10,
      "levels": {
        "1_novice": "Excessive turns or redundant operations",
        "2_developing": "Some waste but acceptable overall",
        "3_competent": "Reasonable resource usage for task complexity",
        "4_expert": "Lean execution with minimal waste",
        "5_master": "Optimal efficiency; maximum value per token"
      }
    }
  ]'::jsonb,
  3.0, 4.2
)
ON CONFLICT (role, task_type, version) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────
-- ORCHESTRATOR RUBRICS (chief-of-staff, cto, clo, vp-research, ops)
-- ───────────────────────────────────────────────────────────────────

-- Chief of Staff: orchestrate task
INSERT INTO role_rubrics (role, task_type, dimensions, passing_score, excellence_score)
VALUES (
  'chief-of-staff', 'orchestrate', '
  [
    {
      "name": "delegation_quality",
      "weight": 0.25,
      "levels": {
        "1_novice": "Work not delegated or assigned to wrong agents",
        "2_developing": "Delegation occurs but often mismatched to agent strengths",
        "3_competent": "Appropriate agent-task matching with clear briefs",
        "4_expert": "Strategic delegation leveraging agent world models",
        "5_master": "Optimal workload distribution with growth-opportunity assignments"
      }
    },
    {
      "name": "evaluation_rigor",
      "weight": 0.25,
      "levels": {
        "1_novice": "No evaluation of delegated work",
        "2_developing": "Cursory review without rubric-based assessment",
        "3_competent": "Rubric-based evaluation with actionable feedback",
        "4_expert": "Thorough evaluation driving world model updates",
        "5_master": "Calibrated grading with developmental coaching"
      }
    },
    {
      "name": "strategic_alignment",
      "weight": 0.20,
      "levels": {
        "1_novice": "Actions disconnected from directives",
        "2_developing": "Loose connection to strategic goals",
        "3_competent": "Clear alignment with active directives",
        "4_expert": "Proactive identification of directive implications",
        "5_master": "Strategic synthesis across multiple directives with T+1 foresight"
      }
    },
    {
      "name": "information_synthesis",
      "weight": 0.15,
      "levels": {
        "1_novice": "Raw data forwarded without synthesis",
        "2_developing": "Basic summarization without insight",
        "3_competent": "Meaningful synthesis with key takeaways",
        "4_expert": "Cross-functional insights connecting disparate data",
        "5_master": "Predictive synthesis identifying emerging patterns"
      }
    },
    {
      "name": "communication_to_founders",
      "weight": 0.15,
      "levels": {
        "1_novice": "Reports missing or uninformative",
        "2_developing": "Verbose reports requiring founder effort to parse",
        "3_competent": "Clear, structured briefings with action items",
        "4_expert": "Executive-quality briefings calibrated to founder preferences",
        "5_master": "Anticipatory communication surfacing decisions before asked"
      }
    }
  ]'::jsonb,
  3.0, 4.2
)
ON CONFLICT (role, task_type, version) DO NOTHING;

-- CTO: platform_health_check
INSERT INTO role_rubrics (role, task_type, dimensions, passing_score, excellence_score)
VALUES (
  'cto', 'platform_health_check', '
  [
    {
      "name": "diagnostic_thoroughness",
      "weight": 0.30,
      "levels": {
        "1_novice": "Checks fewer than half of relevant systems",
        "2_developing": "Covers most systems but misses edge cases",
        "3_competent": "Comprehensive coverage of all production systems",
        "4_expert": "Deep diagnostics including dependency health and performance trends",
        "5_master": "Proactive identification of emerging risks before they manifest"
      }
    },
    {
      "name": "cost_awareness",
      "weight": 0.25,
      "levels": {
        "1_novice": "No cost data referenced",
        "2_developing": "Costs mentioned but not analyzed",
        "3_competent": "Cost trends identified with basic anomaly detection",
        "4_expert": "Actionable cost optimization recommendations",
        "5_master": "Predictive cost modeling with ROI-justified recommendations"
      }
    },
    {
      "name": "incident_response",
      "weight": 0.25,
      "levels": {
        "1_novice": "Issues detected but not escalated",
        "2_developing": "Issues escalated without context or priority",
        "3_competent": "Clear escalation with severity assessment",
        "4_expert": "Escalation with root cause analysis and remediation plan",
        "5_master": "Autonomous remediation of known issues with founder notification"
      }
    },
    {
      "name": "report_quality",
      "weight": 0.20,
      "levels": {
        "1_novice": "Raw tool output without interpretation",
        "2_developing": "Basic summary without trends",
        "3_competent": "Well-structured report with key metrics and trends",
        "4_expert": "Executive summary with drill-down details and recommendations",
        "5_master": "Strategic health report connecting tech state to business impact"
      }
    }
  ]'::jsonb,
  3.0, 4.2
)
ON CONFLICT (role, task_type, version) DO NOTHING;

-- CLO: regulatory_scan
INSERT INTO role_rubrics (role, task_type, dimensions, passing_score, excellence_score)
VALUES (
  'clo', 'regulatory_scan', '
  [
    {
      "name": "coverage_breadth",
      "weight": 0.30,
      "levels": {
        "1_novice": "Only checks obvious regulatory areas",
        "2_developing": "Covers primary jurisdictions but misses emerging regulations",
        "3_competent": "Comprehensive scan across all relevant regulatory domains",
        "4_expert": "Includes adjacent regulatory areas that may impact business",
        "5_master": "Proactive identification of regulatory trends before enforcement"
      }
    },
    {
      "name": "risk_assessment",
      "weight": 0.30,
      "levels": {
        "1_novice": "Regulations listed without risk evaluation",
        "2_developing": "Basic risk labels without business context",
        "3_competent": "Risk rated with likelihood and impact assessment",
        "4_expert": "Risk quantified with mitigation recommendations",
        "5_master": "Strategic risk framework with prioritized action plan"
      }
    },
    {
      "name": "actionability",
      "weight": 0.25,
      "levels": {
        "1_novice": "No actionable recommendations",
        "2_developing": "Vague recommendations without specifics",
        "3_competent": "Clear, specific recommendations with owners",
        "4_expert": "Time-bound recommendations with compliance checkpoints",
        "5_master": "Automated compliance monitoring recommendations"
      }
    },
    {
      "name": "communication_clarity",
      "weight": 0.15,
      "levels": {
        "1_novice": "Legal jargon without explanation",
        "2_developing": "Mix of technical and accessible language",
        "3_competent": "Clear explanations accessible to non-legal stakeholders",
        "4_expert": "Layered communication for different audiences",
        "5_master": "Strategic narrative connecting legal landscape to business strategy"
      }
    }
  ]'::jsonb,
  3.0, 4.2
)
ON CONFLICT (role, task_type, version) DO NOTHING;

-- VP Research: decompose_research
INSERT INTO role_rubrics (role, task_type, dimensions, passing_score, excellence_score)
VALUES (
  'vp-research', 'decompose_research', '
  [
    {
      "name": "decomposition_quality",
      "weight": 0.35,
      "levels": {
        "1_novice": "Research question not meaningfully decomposed",
        "2_developing": "Obvious sub-questions only; key angles missed",
        "3_competent": "Thorough decomposition covering main research angles",
        "4_expert": "Strategic decomposition with non-obvious cross-cutting angles",
        "5_master": "Optimal decomposition balancing breadth, depth, and team capabilities"
      }
    },
    {
      "name": "analyst_routing",
      "weight": 0.25,
      "levels": {
        "1_novice": "Research tasks not assigned to appropriate analysts",
        "2_developing": "Basic matching without considering analyst expertise",
        "3_competent": "Good analyst-task matching based on domain expertise",
        "4_expert": "Strategic routing considering analyst workload and growth areas",
        "5_master": "Optimal routing with cross-pollination opportunities"
      }
    },
    {
      "name": "search_strategy",
      "weight": 0.20,
      "levels": {
        "1_novice": "No search queries provided to analysts",
        "2_developing": "Generic search queries",
        "3_competent": "Targeted search queries with good keyword coverage",
        "4_expert": "Multi-faceted search strategy with verification queries",
        "5_master": "Expert-level search strategy with source triangulation"
      }
    },
    {
      "name": "brief_clarity",
      "weight": 0.20,
      "levels": {
        "1_novice": "Analyst briefs unclear or missing",
        "2_developing": "Briefs provided but lacking context",
        "3_competent": "Clear briefs with context, scope, and expected output",
        "4_expert": "Briefs include quality criteria and interdependencies",
        "5_master": "Briefs enable autonomous analyst execution with minimal supervision"
      }
    }
  ]'::jsonb,
  3.0, 4.2
)
ON CONFLICT (role, task_type, version) DO NOTHING;

-- Ops: health_check
INSERT INTO role_rubrics (role, task_type, dimensions, passing_score, excellence_score)
VALUES (
  'ops', 'health_check', '
  [
    {
      "name": "monitoring_coverage",
      "weight": 0.30,
      "levels": {
        "1_novice": "Checks only basic service availability",
        "2_developing": "Covers core services but misses supporting infrastructure",
        "3_competent": "Comprehensive check of all services, databases, and queues",
        "4_expert": "Includes cross-service dependency checks and latency analysis",
        "5_master": "Predictive monitoring detecting degradation before outage"
      }
    },
    {
      "name": "anomaly_detection",
      "weight": 0.25,
      "levels": {
        "1_novice": "Only reports explicit errors",
        "2_developing": "Detects obvious threshold violations",
        "3_competent": "Identifies trend anomalies and unusual patterns",
        "4_expert": "Correlates anomalies across services for root cause",
        "5_master": "Pattern recognition across historical incidents"
      }
    },
    {
      "name": "remediation_action",
      "weight": 0.25,
      "levels": {
        "1_novice": "No remediation attempted",
        "2_developing": "Basic retry of failed services",
        "3_competent": "Appropriate remediation actions with escalation when needed",
        "4_expert": "Autonomous resolution of known issues with verification",
        "5_master": "Preventive actions based on predictive analysis"
      }
    },
    {
      "name": "status_reporting",
      "weight": 0.20,
      "levels": {
        "1_novice": "No status report generated",
        "2_developing": "Basic pass/fail status",
        "3_competent": "Structured report with metrics, trends, and action items",
        "4_expert": "Contextualized report linking ops state to business impact",
        "5_master": "Predictive report with capacity planning recommendations"
      }
    }
  ]'::jsonb,
  3.0, 4.2
)
ON CONFLICT (role, task_type, version) DO NOTHING;
