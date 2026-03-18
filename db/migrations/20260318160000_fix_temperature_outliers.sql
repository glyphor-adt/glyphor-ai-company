-- C.9: Fix temperature outliers identified by fleet audit
-- design-critic (Sofia): 0.7 → 0.25 (precision evaluation role — needs consistent, deterministic critiques)
-- template-architect (Ryan): 0.7 → 0.35 (structural architecture role — needs consistency with slight creativity)

UPDATE company_agents SET temperature = 0.25 WHERE role = 'design-critic';
UPDATE company_agents SET temperature = 0.35 WHERE role = 'template-architect';
