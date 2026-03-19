import { pool } from '@glyphor/shared/db';

async function main() {
  await pool.query(
    `UPDATE decisions SET resolved_by = 'founder:kristina', resolution_note = 'Root cause: Graph API 401 during Teams notification crashed tool. Fix deployed commit a64d4e19. LLM outage Mar 18 also resolved. Tool reputation counters reset.' WHERE title LIKE '%create_decision%401%' AND status = 'resolved'`
  );
  console.log('Resolution notes updated');
  await pool.end();
}
main();
