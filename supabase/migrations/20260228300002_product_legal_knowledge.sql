-- Add knowledge graph entries for product legal pages so all agents
-- (especially CLO) have accurate facts about ToS / Privacy Policy status.

INSERT INTO kg_nodes (node_type, name, description, metadata)
VALUES
  ('fact', 'Fuse Legal Pages', 'Fuse (fuse.glyphor.com) has Terms of Service at /terms and Privacy Policy at /privacy, both linked in the site footer. Users must accept ToS and Privacy Policy during account creation.', '{"product": "fuse", "verified": "2026-02-28", "category": "compliance"}'::jsonb),
  ('fact', 'Pulse Legal Pages', 'Pulse (pulse.glyphor.com) has Terms of Service at /terms and Privacy Policy at /privacy, both linked in the site footer. Users must accept ToS and Privacy Policy during account creation.', '{"product": "pulse", "verified": "2026-02-28", "category": "compliance"}'::jsonb)
ON CONFLICT DO NOTHING;

-- Link facts to product entities
INSERT INTO kg_edges (source_id, target_id, relation, weight)
SELECT src.id, tgt.id, 'HAS_COMPLIANCE', 1.0
FROM kg_nodes src, kg_nodes tgt
WHERE src.name = 'Fuse' AND src.node_type = 'entity'
  AND tgt.name = 'Fuse Legal Pages' AND tgt.node_type = 'fact'
ON CONFLICT DO NOTHING;

INSERT INTO kg_edges (source_id, target_id, relation, weight)
SELECT src.id, tgt.id, 'HAS_COMPLIANCE', 1.0
FROM kg_nodes src, kg_nodes tgt
WHERE src.name = 'Pulse' AND src.node_type = 'entity'
  AND tgt.name = 'Pulse Legal Pages' AND tgt.node_type = 'fact'
ON CONFLICT DO NOTHING;
