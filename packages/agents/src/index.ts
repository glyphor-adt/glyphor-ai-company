// Executive agents
export { runChiefOfStaff, type CoSRunParams } from './chief-of-staff/run.js';
export { runCTO, type CTORunParams } from './cto/run.js';
export { runCFO, type CFORunParams } from './cfo/run.js';
export { runCLO, type CLORunParams } from './clo/run.js';
export { runCPO, type CPORunParams } from './cpo/run.js';
export { runCMO, type CMORunParams } from './cmo/run.js';
export { runVPCS, type VPCSRunParams } from './vp-customer-success/run.js';
export { runVPSales, type VPSalesRunParams } from './vp-sales/run.js';
export { runVPDesign, type VPDesignRunParams } from './vp-design/run.js';

// Sub-team agents — Engineering
export { runPlatformEngineer, type PlatformEngineerRunParams } from './platform-engineer/run.js';
export { runQualityEngineer, type QualityEngineerRunParams } from './quality-engineer/run.js';
export { runDevOpsEngineer, type DevOpsEngineerRunParams } from './devops-engineer/run.js';

// Sub-team agents — Product
export { runUserResearcher, type UserResearcherRunParams } from './user-researcher/run.js';
export { runCompetitiveIntel, type CompetitiveIntelRunParams } from './competitive-intel/run.js';

// Sub-team agents — Finance
export { runRevenueAnalyst, type RevenueAnalystRunParams } from './revenue-analyst/run.js';
export { runCostAnalyst, type CostAnalystRunParams } from './cost-analyst/run.js';

// Sub-team agents — Marketing
export { runContentCreator, type ContentCreatorRunParams } from './content-creator/run.js';
export { runSeoAnalyst, type SeoAnalystRunParams } from './seo-analyst/run.js';
export { runSocialMediaManager, type SocialMediaManagerRunParams } from './social-media-manager/run.js';

// Sub-team agents — Customer Success
export { runOnboardingSpecialist, type OnboardingSpecialistRunParams } from './onboarding-specialist/run.js';
export { runSupportTriage, type SupportTriageRunParams } from './support-triage/run.js';

// Sub-team agents — Sales
export { runAccountResearch, type AccountResearchRunParams } from './account-research/run.js';

// Sub-team agents — Design
export { runUiUxDesigner, type UiUxDesignerRunParams } from './ui-ux-designer/run.js';
export { runFrontendEngineer, type FrontendEngineerRunParams } from './frontend-engineer/run.js';
export { runDesignCritic, type DesignCriticRunParams } from './design-critic/run.js';
export { runTemplateArchitect, type TemplateArchitectRunParams } from './template-architect/run.js';

// Sub-team agents — IT / M365
export { runM365Admin, type M365AdminRunParams } from './m365-admin/run.js';

// Sub-team agents — Global Admin
export { runGlobalAdmin, type GlobalAdminRunParams } from './global-admin/run.js';

// Operations
export { runOps, type OpsRunParams } from './ops/run.js';

// Strategy Lab v2 — Research Analysts
export { runCompetitiveResearchAnalyst, type CompetitiveResearchAnalystRunParams } from './competitive-research-analyst/run.js';
export { runMarketResearchAnalyst, type MarketResearchAnalystRunParams } from './market-research-analyst/run.js';
export { runTechnicalResearchAnalyst, type TechnicalResearchAnalystRunParams } from './technical-research-analyst/run.js';
export { runIndustryResearchAnalyst, type IndustryResearchAnalystRunParams } from './industry-research-analyst/run.js';

// ── System prompt map (keyed by agent role slug) ──
import { CHIEF_OF_STAFF_SYSTEM_PROMPT } from './chief-of-staff/systemPrompt.js';
import { CTO_SYSTEM_PROMPT } from './cto/systemPrompt.js';
import { CFO_SYSTEM_PROMPT } from './cfo/systemPrompt.js';
import { CLO_SYSTEM_PROMPT } from './clo/systemPrompt.js';
import { CPO_SYSTEM_PROMPT } from './cpo/systemPrompt.js';
import { CMO_SYSTEM_PROMPT } from './cmo/systemPrompt.js';
import { VP_CUSTOMER_SUCCESS_SYSTEM_PROMPT } from './vp-customer-success/systemPrompt.js';
import { VP_SALES_SYSTEM_PROMPT } from './vp-sales/systemPrompt.js';
import { VP_DESIGN_SYSTEM_PROMPT } from './vp-design/systemPrompt.js';
import { PLATFORM_ENGINEER_SYSTEM_PROMPT } from './platform-engineer/systemPrompt.js';
import { QUALITY_ENGINEER_SYSTEM_PROMPT } from './quality-engineer/systemPrompt.js';
import { DEVOPS_ENGINEER_SYSTEM_PROMPT } from './devops-engineer/systemPrompt.js';
import { USER_RESEARCHER_SYSTEM_PROMPT } from './user-researcher/systemPrompt.js';
import { COMPETITIVE_INTEL_SYSTEM_PROMPT } from './competitive-intel/systemPrompt.js';
import { REVENUE_ANALYST_SYSTEM_PROMPT } from './revenue-analyst/systemPrompt.js';
import { COST_ANALYST_SYSTEM_PROMPT } from './cost-analyst/systemPrompt.js';
import { CONTENT_CREATOR_SYSTEM_PROMPT } from './content-creator/systemPrompt.js';
import { SEO_ANALYST_SYSTEM_PROMPT } from './seo-analyst/systemPrompt.js';
import { SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT } from './social-media-manager/systemPrompt.js';
import { ONBOARDING_SPECIALIST_SYSTEM_PROMPT } from './onboarding-specialist/systemPrompt.js';
import { SUPPORT_TRIAGE_SYSTEM_PROMPT } from './support-triage/systemPrompt.js';
import { ACCOUNT_RESEARCH_SYSTEM_PROMPT } from './account-research/systemPrompt.js';
import { UI_UX_DESIGNER_SYSTEM_PROMPT } from './ui-ux-designer/systemPrompt.js';
import { FRONTEND_ENGINEER_SYSTEM_PROMPT } from './frontend-engineer/systemPrompt.js';
import { DESIGN_CRITIC_SYSTEM_PROMPT } from './design-critic/systemPrompt.js';
import { TEMPLATE_ARCHITECT_SYSTEM_PROMPT } from './template-architect/systemPrompt.js';
import { M365_ADMIN_SYSTEM_PROMPT } from './m365-admin/systemPrompt.js';
import { GLOBAL_ADMIN_SYSTEM_PROMPT } from './global-admin/systemPrompt.js';
import { OPS_SYSTEM_PROMPT } from './ops/systemPrompt.js';
import { COMPETITIVE_RESEARCH_ANALYST_SYSTEM_PROMPT } from './competitive-research-analyst/systemPrompt.js';
import { MARKET_RESEARCH_ANALYST_SYSTEM_PROMPT } from './market-research-analyst/systemPrompt.js';
import { TECHNICAL_RESEARCH_ANALYST_SYSTEM_PROMPT } from './technical-research-analyst/systemPrompt.js';
import { INDUSTRY_RESEARCH_ANALYST_SYSTEM_PROMPT } from './industry-research-analyst/systemPrompt.js';

export const SYSTEM_PROMPTS: Record<string, string> = {
  'chief-of-staff': CHIEF_OF_STAFF_SYSTEM_PROMPT,
  'cto': CTO_SYSTEM_PROMPT,
  'cfo': CFO_SYSTEM_PROMPT,
  'clo': CLO_SYSTEM_PROMPT,
  'cpo': CPO_SYSTEM_PROMPT,
  'cmo': CMO_SYSTEM_PROMPT,
  'vp-customer-success': VP_CUSTOMER_SUCCESS_SYSTEM_PROMPT,
  'vp-sales': VP_SALES_SYSTEM_PROMPT,
  'vp-design': VP_DESIGN_SYSTEM_PROMPT,
  'platform-engineer': PLATFORM_ENGINEER_SYSTEM_PROMPT,
  'quality-engineer': QUALITY_ENGINEER_SYSTEM_PROMPT,
  'devops-engineer': DEVOPS_ENGINEER_SYSTEM_PROMPT,
  'user-researcher': USER_RESEARCHER_SYSTEM_PROMPT,
  'competitive-intel': COMPETITIVE_INTEL_SYSTEM_PROMPT,
  'revenue-analyst': REVENUE_ANALYST_SYSTEM_PROMPT,
  'cost-analyst': COST_ANALYST_SYSTEM_PROMPT,
  'content-creator': CONTENT_CREATOR_SYSTEM_PROMPT,
  'seo-analyst': SEO_ANALYST_SYSTEM_PROMPT,
  'social-media-manager': SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT,
  'onboarding-specialist': ONBOARDING_SPECIALIST_SYSTEM_PROMPT,
  'support-triage': SUPPORT_TRIAGE_SYSTEM_PROMPT,
  'account-research': ACCOUNT_RESEARCH_SYSTEM_PROMPT,
  'ui-ux-designer': UI_UX_DESIGNER_SYSTEM_PROMPT,
  'frontend-engineer': FRONTEND_ENGINEER_SYSTEM_PROMPT,
  'design-critic': DESIGN_CRITIC_SYSTEM_PROMPT,
  'template-architect': TEMPLATE_ARCHITECT_SYSTEM_PROMPT,
  'm365-admin': M365_ADMIN_SYSTEM_PROMPT,
  'global-admin': GLOBAL_ADMIN_SYSTEM_PROMPT,
  'ops': OPS_SYSTEM_PROMPT,
  'competitive-research-analyst': COMPETITIVE_RESEARCH_ANALYST_SYSTEM_PROMPT,
  'market-research-analyst': MARKET_RESEARCH_ANALYST_SYSTEM_PROMPT,
  'technical-research-analyst': TECHNICAL_RESEARCH_ANALYST_SYSTEM_PROMPT,
  'industry-research-analyst': INDUSTRY_RESEARCH_ANALYST_SYSTEM_PROMPT,
};
