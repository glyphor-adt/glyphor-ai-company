-- Atomic merge for research packets to prevent race conditions
-- when multiple analysts submit in parallel.
CREATE OR REPLACE FUNCTION merge_research_packet(
  p_analysis_id text,
  p_packet_type text,
  p_packet_data jsonb
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE strategy_analyses
  SET research_packets = COALESCE(research_packets, '{}'::jsonb) || jsonb_build_object(p_packet_type, p_packet_data)
  WHERE id = p_analysis_id;
$$;
