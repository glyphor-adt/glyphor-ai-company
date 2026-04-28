# Task: Phase 1.5 — Clean residual references to the 16 purged agent roles

You are continuing the agent-purge work from commits `42dfe4ee`,
`9819c122`, and `8d436556`. The 16 roles are gone from source and the
DB migration `20260427235100_purge_16_orphan_agent_roles.sql` has
been applied to production. The cross-repo grep still shows 2,652
hits across 228 files. Most of those are immutable history. A subset
is real runtime debt.

This phase cleans only the runtime debt. We are NOT pursuing zero
grep hits — historical migrations and audit artifacts are expected
to mention the deleted roles, and editing them would be wrong.

## Ground rules

- Push directly to `main`. One commit per sub-phase (1.5a, 1.5b,
  1.5c). Build must pass at every commit boundary.
- Run `npm run typecheck` (or `npx turbo run typecheck`) AND
  `npx turbo run test` before each commit. Both must pass.
- Cite `path:line` in your status updates.
- If anything doesn't match these instructions, STOP and report.
  Do not improvise around it.
- VS Code git auto-commit must be disabled. If you see a stray
  auto-commit appear during your work, soft-reset and recommit as
  one clean commit. Report it.
- Never use `--force` or rewrite history.

## The 16 deleted roles (source of truth)

```
competitive-intel
competitive-research-analyst
content-creator
design-critic
frontend-engineer
global-admin
head-of-hr
m365-admin
market-research-analyst
platform-intel
seo-analyst
social-media-manager
template-architect
ui-ux-designer
user-researcher
vp-sales
```

Define this list as a constant in your shell scripts so you can't
typo a role name.

## What is OUT of scope (do not touch)

- `db/migrations/*.sql` — immutable historical migrations.
- `combined_migration.sql` at repo root — same rationale.
- `_provision_agents.sql`, `_apps.txt`, `.agent-identities-created.json`
  — historical seed snapshots.
- `audit-reports/**` — dated evidence artifacts.
- `docs/ARCHITECTURE.md` — handled in a later phase.

If you find yourself wanting to edit any of these, stop and report.

---

## Phase 1.5a — Delete artifact and scratch files

This is the cheapest cleanup. ~50 files, ~600 grep hits removed,
zero behavioral risk.

### Steps

1. Inspect what's actually in these directories:
   ```powershell
   Get-ChildItem -Recurse artifacts/tmp/ 2>$null | Measure-Object -Property Length -Sum
   Get-ChildItem -Recurse artifacts/skill-tests/ 2>$null | Measure-Object -Property Length -Sum
   ```

2. Delete the directories:
   ```powershell
   if (Test-Path artifacts/tmp) { git rm -r artifacts/tmp }
   if (Test-Path artifacts/skill-tests) { git rm -r artifacts/skill-tests }
   ```

3. Add to `.gitignore` so they can't return:
   ```
   # diagnostic and scratch artifacts — not tracked
   artifacts/tmp/
   artifacts/skill-tests/
   ```
   Append, don't overwrite.

4. Confirm no production code imports anything from those paths:
   ```powershell
   git grep -n "artifacts/tmp\|artifacts/skill-tests"
   ```
   Expected: zero hits in `packages/`, `scripts/`, or any TS/JS file.
   If you find a hit, STOP and report — something else is using those
   files and we need to handle it differently.

5. Verify:
   - `npm run typecheck` — must pass
   - `npx turbo run test` — must pass

6. Commit and push:
   ```
   git add -A
   git commit -m "chore: remove diagnostic artifacts and add to gitignore

   artifacts/tmp/ and artifacts/skill-tests/ contain captured
   diagnostic output from the 2026-04-27 audit. Not executable
   code, not referenced by production. Removed and gitignored."

   git push origin main
   ```

7. Report: file count deleted, grep hit reduction (run the cross-repo
   grep before and after).

---

## Phase 1.5b — Clean runtime registries (Bucket A)

This is the substantive sub-phase. ~38 files in `packages/agents/src/shared/`
and `packages/agent-runtime/src/` contain string-literal references to
the 16 deleted roles in code that drives runtime behavior — tool grants,
assignee routing, tool permission policy, type narrowing, persona
maps. They didn't break the build, so Phase 1 deferred them. Now we
clean them.

### Step 1: Enumerate the affected files

Define the role list as a regex alternation and find every file in
the runtime layers that mentions any of the 16:

```powershell
$roles = @(
  "competitive-intel","competitive-research-analyst","content-creator",
  "design-critic","frontend-engineer","global-admin","head-of-hr",
  "m365-admin","market-research-analyst","platform-intel","seo-analyst",
  "social-media-manager","template-architect","ui-ux-designer",
  "user-researcher","vp-sales"
)
$pattern = ($roles | ForEach-Object { [regex]::Escape($_) }) -join "|"

git grep -l -E "$pattern" -- 'packages/agents/src/shared/*.ts' 'packages/agent-runtime/src/**/*.ts' ':!**/*.test.ts'
```

Expected output: ~38 files. Save this list — it is the work queue
for Step 2.

### Step 2: Per-file cleanup with reporting

This is the part where you slow down. For each file in the list,
do the following IN ORDER:

1. Read the file's references to the deleted roles. Identify what
   the role entry *does* — tool grant, routing decision, type narrowing,
   persona, capability flag, etc.

2. Categorize the entry:
   - **Pure data** — the role appears in a lookup table, array, or
     map and removing it has no side effect beyond shrinking the data.
     Examples: `voiceMap.ts` entries, `agentEntraRoles.ts` mappings.
   - **Behavioral** — removing the entry changes how the runtime
     decides something. Examples: a tool grant being removed could
     leave a tool with zero grantees; a wake rule being removed
     could cancel a scheduled cron behavior; a routing default could
     change.

3. For pure-data entries: remove the lines, preserve formatting.

4. For behavioral entries: remove the lines AND record a one-line
   note for the final report. Format:
   ```
   <path>:<line> — removed <role> entry from <map/list>; behavior change: <description>
   ```
   Example:
   ```
   packages/agents/src/shared/toolPermissionPolicy.ts:147 —
   removed `head-of-hr → entra_user_admin` grant; tool now has zero
   grantees.
   ```

5. After editing, run a quick local check on that file:
   ```powershell
   npx tsc --noEmit -p packages/agents/tsconfig.json
   ```
   (Or the equivalent for `agent-runtime`.) If TypeScript errors,
   the entry was load-bearing. Report it and STOP — do not try to
   patch up other files to compensate.

### Step 3: Type-level cleanup

Some role-name references are in TypeScript union types like:
```typescript
type AgentRole = 'cmo' | 'cto' | ... | 'head-of-hr' | ...;
```

When you remove a member from a union type, downstream consumers
sometimes break (exhaustive switches, narrowed types). If TypeScript
fails after a union-type edit, the failures point at code that needs
attention — that is *useful*. Do not paper over with `any` or
`as never`. Read the consumer, decide whether the consumer should
also drop that role, and edit accordingly.

### Step 4: Tests

Some `*.test.ts` files in `packages/agents/src/shared/` and
`packages/agent-runtime/src/` may import or assert on the deleted
roles. After your edits, run the test suite:
```powershell
npx turbo run test
```

If a test fails because it asserts behavior for a deleted role, the
test is dead code. Delete it with `git rm`. Do NOT edit a test to
"work around" a deleted role — that's the wrong direction.

### Step 5: Verify and commit

- Cross-repo grep over the runtime layers:
  ```powershell
  git grep -E "$pattern" -- 'packages/agents/src/shared/*.ts' 'packages/agent-runtime/src/**/*.ts' ':!**/*.test.ts'
  ```
  Expected: zero hits. If any remain, list them and explain why each
  is intentional (none should be).

- `npm run typecheck` — must pass
- `npx turbo run test` — must pass

- Commit:
  ```
  git add -A
  git commit -m "chore(agents): remove residual role refs in runtime registries

  Cleans tool-grant maps, routing tables, persona dictionaries, and
  type-level role unions in packages/agents/src/shared and
  packages/agent-runtime/src. Companion to commits 42dfe4ee and
  8d436556.

  Behavioral changes documented in PR description / commit body."

  git push origin main
  ```

- In the commit body OR a follow-up status report, include the list
  of behavioral notes from Step 2.

---

## Phase 1.5c — Surface-area cleanup (Bucket B)

Lower-urgency but still real. Dashboard types, voice persona map,
scheduler logging, smoketest layers, and operational scripts that
mention the deleted roles.

### Step 1: Enumerate

```powershell
git grep -l -E "$pattern" -- `
  'packages/dashboard/src/**/*.ts' `
  'packages/dashboard/src/**/*.tsx' `
  'packages/voice-gateway/src/*.ts' `
  'packages/scheduler/src/*.ts' `
  'packages/smoketest/src/**/*.ts' `
  'scripts/*.ts' `
  ':!**/*.test.ts'
```

Subtract the registries already cleaned in Phase 1
(`packages/scheduler/src/czProtocolApi.ts`, `agentKnowledgeEvaluator.ts`,
`server.ts:RUN_STATUS_DEPARTMENT_FALLBACK`).

Expected: ~12 to ~20 files.

### Step 2: Bucket the scripts

`scripts/*.ts` is a mix of one-shot historical work and live
operational tools. For each script in the grep output, decide:

- **Keep** if the script is referenced by:
  - any `package.json` `scripts` entry
  - any CI config (`cloudbuild*.yaml`, `.github/workflows/*`)
  - any Cloud Scheduler job (look for `cron-*.yaml`, `cronManager.ts`
    references)

  If kept, edit it to remove the deleted-role references.

- **Delete** otherwise. These are diagnostic/audit one-shots from
  earlier work. `git rm` them.

Report which scripts you kept vs deleted and why.

### Step 3: Per-file cleanup

Same pattern as 1.5b. Pure-data deletions are straightforward.
Behavioral changes get reported.

`packages/dashboard/src/lib/types.ts` deserves special care — it has
71 hits and is likely a TypeScript union type that the rest of the
dashboard narrows against. Removing union members will cause
downstream type errors that are *informational* — they tell you which
UI components need updates. Do not silence them.

`packages/voice-gateway/src/voiceMap.ts` is the persona-to-voice map
the voice-gateway uses. Pure data; remove entries cleanly.

Smoketest layer files (`layer{03,13,15,18}*.ts`) likely have role
arrays for testing. Remove dead role names from the arrays. If a
test layer specifically tests the 16 deleted roles, that whole layer
test becomes dead — delete it and reduce the layer count if needed.

### Step 4: Verify and commit

- Cross-repo grep over the targeted layers:
  ```powershell
  git grep -E "$pattern" -- `
    'packages/dashboard/src/**' `
    'packages/voice-gateway/src/**' `
    'packages/scheduler/src/*.ts' `
    'packages/smoketest/src/**' `
    'scripts/*.ts'
  ```
  Expected: zero hits, with the same caveats as 1.5b.

- `npm run typecheck` — must pass
- `npx turbo run test` — must pass

- Commit:
  ```
  git add -A
  git commit -m "chore: clean residual role refs in dashboard, voice, scheduler, scripts

  Removes deleted-role references from dashboard types, voice
  persona map, scheduler logging surfaces, smoketest layers, and
  operational scripts. Final source-side cleanup for the 16-role
  purge."

  git push origin main
  ```

---

## Phase 1.5d — Final verification

After all three sub-phases:

1. Run the global cross-repo grep one last time, EXCLUDING the
   intentionally-historical paths:
   ```powershell
   git grep -E "$pattern" -- ':!db/migrations' ':!audit-reports' ':!combined_migration.sql' ':!_provision_agents.sql' ':!_apps.txt' ':!.agent-identities-created.json'
   ```

   Expected: zero hits. If any remain, list them — these are
   real misses and we need to handle them in a 1.5e.

2. Run `npm run typecheck` and `npx turbo run test` one final time.

3. Run any smoketest layers that were not modified, to make sure
   the runtime doesn't crash on a missing role lookup:
   ```powershell
   npx turbo run smoke
   ```
   (Or whatever the local smoke command is. If there isn't a local
   one, note that CI/Cloud Build will run it on push and report
   when those results come back.)

## Final report

When all four sub-phases land cleanly, produce a report containing:

- Three commit SHAs (1.5a, 1.5b, 1.5c).
- Total grep hit reduction: starting at 2,652, ending at <expected
  ~178, all in historical paths>.
- Behavioral changes from 1.5b — the list of registry edits where
  removing a role changed runtime decisions.
- Scripts kept vs deleted in 1.5c, with justification.
- Anything unexpected.

If any verification fails, STOP and report. Do not skip a sub-phase
to make later steps fit. Each sub-phase is independent and
committable on its own; we'd rather land 1.5a clean and stop than
ship all three with a regression.
