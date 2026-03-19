-- Move orchestration and visual_analysis routes from gemini-2.5-pro
-- to gemini-3.1-flash-lite-preview.
--
-- gemini-2.5-pro costs $1.25/$10.00 per 1M tokens (flagship tier).
-- gemini-3.1-flash-lite-preview costs $0.25/$1.50 per 1M tokens and
-- benchmarks higher on quality — strictly better for these routes.

UPDATE routing_config
SET model_slug = 'gemini-3.1-flash-lite-preview', updated_at = NOW()
WHERE route_name = 'orchestration'
  AND model_slug = 'gemini-2.5-pro';

UPDATE routing_config
SET model_slug = 'gemini-3.1-flash-lite-preview', updated_at = NOW()
WHERE route_name = 'visual_analysis'
  AND model_slug = 'gemini-2.5-pro';
