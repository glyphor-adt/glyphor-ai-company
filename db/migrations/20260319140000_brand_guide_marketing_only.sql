-- Restrict brand_guide to marketing audience only (was 'all').
-- Brand guide is a large reference doc (~27KB) that should NOT be auto-injected
-- into every agent's context. Marketing agents can still read it on demand
-- via the read_company_doctrine tool with section_filter = 'brand_guide'.
UPDATE company_knowledge_base
SET audience = 'marketing',
    updated_at = NOW()
WHERE section = 'brand_guide';
