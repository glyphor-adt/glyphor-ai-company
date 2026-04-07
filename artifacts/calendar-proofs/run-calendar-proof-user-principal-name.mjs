import { mkdirSync, writeFileSync } from 'node:fs';
import { createCalendarMcpProofTools } from '../../packages/agents/dist/shared/calendarMcpProofTools.js';

const tools = createCalendarMcpProofTools({ defaultAgentRole: 'm365-admin' });
const tool = tools.find((entry) => entry.name === 'evaluate_calendar_mcp_founder_create_event');
if (!tool) throw new Error('evaluate_calendar_mcp_founder_create_event not found');

const now = new Date();
const start = new Date(now.getTime() + 12 * 60 * 1000);
const end = new Date(start.getTime() + 15 * 60 * 1000);
const stamp = now.toISOString().replace(/[:.]/g, '-');
const params = {
  founder: 'kristina',
  target_mode: 'user_principal_name',
  cleanup_mode: 'delete',
  inspect_created_event: true,
  approval_reference: 'calendar-mcp-proof-2026-04-07-user-principal-name',
  subject: `Calendar MCP Proof user_principal_name ${stamp}`,
  start: start.toISOString(),
  end: end.toISOString(),
  body: 'Real founder-calendar MCP proof execution using user_principal_name targeting.',
  location: 'Proof cleanup validation',
  is_online: false,
  time_zone: 'America/Chicago',
  show_as: 'busy'
};

const result = await tool.execute(params, { agentRole: 'm365-admin' });
const payload = { executedAt: new Date().toISOString(), params, result };
mkdirSync('artifacts\\calendar-proofs', { recursive: true });
const file = `artifacts\\calendar-proofs\\calendar-proof-user-principal-name-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(payload, null, 2));
console.log(`RESULT_FILE=${file}`);
console.log(JSON.stringify(payload, null, 2));
