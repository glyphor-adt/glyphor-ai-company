-- ═══════════════════════════════════════════════════════════════════
-- DASHBOARD WRITE POLICIES
-- Allow anon role (dashboard) to write to founder-managed tables.
-- The dashboard uses the anon key; without these policies the
-- Edit / Save / New Bulletin buttons silently fail.
-- ═══════════════════════════════════════════════════════════════════

-- ── company_pulse: allow dashboard to update the singleton row ───
CREATE POLICY "Anon update company pulse"
  ON company_pulse FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- ── founder_bulletins: allow dashboard to create & deactivate ────
CREATE POLICY "Anon read bulletins"
  ON founder_bulletins FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon insert bulletins"
  ON founder_bulletins FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon update bulletins"
  ON founder_bulletins FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- ── company_knowledge_base: allow dashboard to edit sections ─────
CREATE POLICY "Anon read knowledge base"
  ON company_knowledge_base FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon update knowledge base"
  ON company_knowledge_base FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
