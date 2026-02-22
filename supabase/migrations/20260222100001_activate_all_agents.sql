-- Set all agents to active status (they all have functional runners)
UPDATE company_agents SET status = 'active' WHERE status = 'stub';
