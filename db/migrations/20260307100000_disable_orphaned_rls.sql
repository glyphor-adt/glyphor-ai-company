-- Migration: Disable orphaned RLS on tables with no policies
-- These tables had RLS enabled in Supabase (where Supabase auth injected policies
-- automatically), but no policies transferred to GCP Cloud SQL.
-- Without policies, RLS blocks ALL writes via non-owner roles (e.g. glyphor_system).
-- Tenant isolation is handled by tenant_id column defaults instead.

ALTER TABLE IF EXISTS constitutional_evaluations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS proposed_constitutional_amendments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS deep_dive_frameworks DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS deep_dive_watchlist DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS strategy_analysis_watchlist DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS decision_chains DISABLE ROW LEVEL SECURITY;
