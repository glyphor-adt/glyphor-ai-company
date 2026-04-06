import 'dotenv/config';
import { runPlatformIntel } from './packages/agents/src/platform-intel/run.ts';

(async () => {
  const message = [
    'Execute fix-completion run now with available patch tools.',
    'Process pending P0/P1 proposals first.',
    'Use apply_patch_call for safe code fixes and mark_tool_fix_applied after each successful fix.',
    'If a proposal requires non-code intervention, create_approval_request.',
    'Return attempted/applied/blocked counts.'
  ].join('\n');

  const result = await runPlatformIntel({ task: 'on_demand', message });
  console.log('RESULT_STATUS', result.status);
  console.log('RESULT_TURNS', result.totalTurns);
  console.log('RESULT_OUTPUT_START');
  console.log(String(result.output ?? '').slice(0, 5000));
  console.log('RESULT_OUTPUT_END');
})().catch((e) => { console.error(e?.stack || e?.message || String(e)); process.exit(1); });
