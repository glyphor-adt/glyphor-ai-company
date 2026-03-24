export type LoadingState = { text: string };

export type LoaderTier = 'quick' | 'standard' | 'deep';

export const LOADER_STATES: Record<LoaderTier, LoadingState[]> = {
  quick: [
    { text: 'Warming up the engines' },
    { text: 'Pulling the latest signals' },
    { text: 'Skimming the highlights' },
    { text: 'Sanity-checking the numbers' },
    { text: 'Wrapping it up with a bow' },
  ],
  standard: [
    { text: 'Caffeinating the research agents' },
    { text: 'Asking the hard questions nobody asked' },
    { text: 'Stalking your competitors (legally)' },
    { text: "Reading every press release so you don't have to" },
    { text: 'Finding the pricing pages they tried to hide' },
    { text: 'Translating corporate speak into English' },
    { text: 'Counting their job postings for clues' },
    { text: 'Following the money trail' },
    { text: 'Separating signal from hype' },
    { text: 'Fact-checking the thought leaders' },
    { text: "Mapping who's actually a threat vs. vibes" },
    { text: "Finding the gaps nobody's filling" },
    { text: 'Arguing with ourselves for quality' },
    { text: "Making charts you'll actually want to read" },
    { text: 'Writing the part where you look brilliant' },
  ],
  deep: [
    { text: 'Caffeinating the research agents' },
    { text: "This one's going to be thorough - settle in" },
    { text: 'Mapping the entire competitive landscape' },
    { text: 'Stalking your competitors (legally)' },
    { text: 'Reading their 10-Ks so you never have to' },
    { text: 'Finding the pricing pages they tried to hide' },
    { text: 'Translating corporate speak into English' },
    { text: 'Counting their job postings for clues' },
    { text: 'Reverse-engineering their tech stack' },
    { text: 'Following the money trail' },
    { text: 'Cross-referencing analyst reports' },
    { text: "Noticing what they're NOT saying" },
    { text: 'Reading between the lines of their roadmap' },
    { text: 'Pulling patent filings... yes, really' },
    { text: 'Separating signal from hype' },
    { text: "Catching someone's math not mathing" },
    { text: 'Fact-checking the thought leaders' },
    { text: 'Running scenario models' },
    { text: 'Scoring threat levels by segment' },
    { text: "Mapping who's actually a threat vs. vibes" },
    { text: "Finding the gaps nobody's filling" },
    { text: 'Evaluating defensive moats' },
    { text: 'Arguing with ourselves for quality' },
    { text: 'Triangulating so hard right now' },
    { text: "Making charts you'll actually want to read" },
    { text: 'Writing the part where you look brilliant' },
    { text: 'One last sanity check...' },
  ],
};

export const HOLD_STATES: LoadingState[] = [
  { text: "Still digging - this one's meaty" },
  { text: 'Found a rabbit hole, going in' },
  { text: 'Your competitors have a lot to say, apparently' },
  { text: 'Almost there... probably' },
  { text: "Making sure we didn't miss anything" },
  { text: 'The agents are arguing about methodology' },
  { text: 'Double-checking the double-check' },
  { text: 'Worth the wait, promise' },
  { text: 'Compiling an unreasonable amount of data' },
  { text: 'Asking one more question... okay maybe two' },
];

export const COMPLETE_STATE: LoadingState = {
  text: 'Your briefing is ready, boss',
};

export function inferTier(taskConfig: {
  type: string;
  competitors?: number;
  searchDepth?: string;
}): LoaderTier {
  if (taskConfig.searchDepth === 'quick') return 'quick';
  if (taskConfig.searchDepth === 'deep' || taskConfig.searchDepth === 'comprehensive') return 'deep';

  const deepTasks = [
    'competitive_landscape',
    'market_analysis',
    'full_audit',
    'strategy_report',
    'market_opportunity',
    'product_strategy',
    'growth_diagnostic',
    'risk_assessment',
    'market_entry',
    'due_diligence',
  ];
  const quickTasks = [
    'single_competitor',
    'news_scan',
    'pricing_check',
    'quick_summary',
  ];

  if (deepTasks.includes(taskConfig.type)) return 'deep';
  if (quickTasks.includes(taskConfig.type)) return 'quick';

  if (taskConfig.competitors && taskConfig.competitors > 10) return 'deep';
  if (taskConfig.competitors && taskConfig.competitors <= 3) return 'quick';

  return 'standard';
}
