-- Strip markdown bold formatting (**) from company_knowledge_base mission section.
-- Dashboard displays content as plain text — raw markdown shows as literal ** characters.
-- Also standardizes the content for clean display.

UPDATE company_knowledge_base
SET content = REPLACE(content, '**', ''),
    version = version + 1,
    updated_at = NOW()
WHERE section = 'mission'
  AND content LIKE '%**%';
