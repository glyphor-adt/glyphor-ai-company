// Executive agents
export { runChiefOfStaff, type CoSRunParams } from './chief-of-staff/run.js';
export { runCTO, type CTORunParams } from './cto/run.js';
export { runCFO, type CFORunParams } from './cfo/run.js';
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

// Operations
export { runOps, type OpsRunParams } from './ops/run.js';
