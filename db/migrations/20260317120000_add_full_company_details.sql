-- Add full company registration details to mission section.
-- EIN, Delaware file number, incorporation date, phone, full registered address.
-- All content is plain text (no markdown) per dashboard display policy.

UPDATE company_knowledge_base
SET content = 'Glyphor is an AI platform company. We build autonomous software that replaces entire development and creative teams. We are not a dev tool, not a copilot, not an assistant — we are the team itself.

Legal Name: Glyphor, Inc.
Entity Type: Delaware C Corporation (60/40 equity — Kristina/Andrew)
EIN: 39-3347175
Incorporation Date: Jul 21, 2025
Delaware File Number: 10262637
Phone: (213) 440-1720
Company Address: 1111b South Governors Avenue, STE 37628, Dover, DE 19904 US
Website/Domain: glyphor.ai
GCP Project: ai-glyphor-company
GCP Billing Account: 012B03-F562EC-184CD8
SharePoint: glyphorai.sharepoint.com/sites/glyphor-knowledge
GitHub Org: glyphor-adt
Employees: 0 W-2. 28 AI agents + 2 human founders.',
    version = version + 1,
    updated_at = NOW()
WHERE section = 'mission';
