-- Migration: Fix RLS policy target role on roadmap_items, research_repository, research_monitors
--
-- BACKGROUND
-- ----------
-- The original policies (20260303150000_product_research_tools.sql) target the
-- LOGIN user `glyphor_system_user`:
--
--   CREATE POLICY roadmap_items_system ON roadmap_items
--     FOR ALL TO glyphor_system_user USING (true) WITH CHECK (true);
--
-- But `systemQuery()` in packages/shared/src/db.ts connects as
-- `glyphor_system_user` and immediately runs `SET ROLE glyphor_system`. After
-- that SET ROLE, the current_user for policy evaluation is `glyphor_system`
-- (the NOLOGIN bypass role), not `glyphor_system_user`. The policy therefore
-- never matches, RLS has no applicable policy, and all FOR ALL queries are
-- blocked.
--
-- All other system-bypass policies in 20260302100003_row_level_security.sql
-- correctly target `glyphor_system` (e.g. system_bypass_tenants,
-- system_bypass_tenant_workspaces, etc.). The Wave 3 migration diverged from
-- that pattern — this migration aligns it.
--
-- FIX
-- ---
-- Drop the mistargeted policies and recreate them on `glyphor_system`, which
-- is what `SET ROLE` actually activates.
--
-- Idempotent: safe to re-apply.

BEGIN;

-- roadmap_items
DROP POLICY IF EXISTS roadmap_items_system ON roadmap_items;
CREATE POLICY roadmap_items_system ON roadmap_items
  FOR ALL TO glyphor_system USING (true) WITH CHECK (true);

-- research_repository
DROP POLICY IF EXISTS research_repository_system ON research_repository;
CREATE POLICY research_repository_system ON research_repository
  FOR ALL TO glyphor_system USING (true) WITH CHECK (true);

-- research_monitors
DROP POLICY IF EXISTS research_monitors_system ON research_monitors;
CREATE POLICY research_monitors_system ON research_monitors
  FOR ALL TO glyphor_system USING (true) WITH CHECK (true);

COMMIT;
