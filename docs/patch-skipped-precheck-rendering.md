# Patch: Skipped Precheck Rendering Fix

> **Issue:** Deterministic precheck skips (`health_check`, `cost_check`, `freshness_check`, `platform_health_check`) are rendered as red errors in the Activity UI. They are not failures — they are intentional skips of template-style scheduled prompts.
>
> **Fix:** Stop writing skip reasons into `run.error`. Render `skipped_precheck` as a neutral badge instead of an error block.
>
> **Files changed:** 2
> **Estimated time:** 20 minutes

---

## Patch 1 of 2: `companyAgentRunner.ts`

### Change A — Around line 1634 (where `skipped_precheck` status is set)

No change needed here. The status assignment is correct. Just confirming the status value stays `skipped_precheck` so the UI can key off it.

### Change B — Around line 2417 (where skip reason is written to error field)

Find the block that writes the skip reason into the error field for `skipped_precheck` runs. It currently looks something like:

```typescript
// BEFORE — around companyAgentRunner.ts:2417
if (result.status === 'skipped_precheck') {
  run.error = result.skipReason;
}
```

Replace with:

```typescript
// AFTER
if (result.status === 'skipped_precheck') {
  run.result_summary = `Precheck skip: ${result.skipReason}`;
  run.error = null;
}
```

> **Why:** `run.error` should mean "something broke." A precheck skip is working as designed. Moving the reason to `result_summary` preserves the audit trail without polluting the error signal. The Activity UI already has access to `result_summary` for display.

---

## Patch 2 of 2: `Activity.tsx`

### Change — Around line 383 (where `run.error` is rendered as red Error block)

Find the block that renders the error display. It currently looks something like:

```tsx
// BEFORE — around Activity.tsx:383
{run.error && (
  <div className="...error-styles...">
    <span className="...">Error</span>
    <p>{run.error}</p>
  </div>
)}
```

Replace with a status-aware rendering block:

```tsx
// AFTER
{run.status === 'skipped_precheck' ? (
  <div
    className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-yellow-500/10 text-yellow-400/80 text-xs cursor-pointer"
    onClick={(e) => {
      const el = e.currentTarget.nextElementSibling;
      if (el) el.classList.toggle('hidden');
    }}
  >
    <svg
      className="w-3.5 h-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"
      />
    </svg>
    <span>Precheck skip</span>
    <svg
      className="w-3 h-3 shrink-0 ml-auto opacity-50"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  </div>
) : run.error ? (
  <div className="...existing-error-styles...">
    <span className="...">Error</span>
    <p>{run.error}</p>
  </div>
) : null}

{/* Collapsed detail for skipped_precheck — hidden by default */}
{run.status === 'skipped_precheck' && run.result_summary && (
  <div className="hidden px-3 py-1.5 text-xs text-neutral-500 border-l-2 border-yellow-500/20 ml-4">
    {run.result_summary}
  </div>
)}
```

> **Rendering behavior:**
> - **Completed runs** — no change, green as usual
> - **Skipped runs** — muted yellow/amber badge reading "Precheck skip", collapsed by default, click to expand and see the reason
> - **Actual errors** — red block, unchanged
>
> **Style notes:** The classes above assume your Tailwind + Dark Glass / Prism Midnight setup. Adjust the color tokens if you're using custom CSS variables instead of Tailwind opacity modifiers. For Prism consistency, you could swap `yellow-500/10` and `yellow-400/80` for your amber/warning tokens if you have them defined in your theme.

---

## Optional: Extract SkipBadge Component

If you want to keep Activity.tsx clean, extract the skip rendering into its own component:

```tsx
// components/SkipBadge.tsx

interface SkipBadgeProps {
  reason?: string | null;
}

export function SkipBadge({ reason }: SkipBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-yellow-500/10 text-yellow-400/80 text-xs w-full text-left"
      >
        <svg
          className="w-3.5 h-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"
          />
        </svg>
        <span>Precheck skip</span>
        <svg
          className={`w-3 h-3 shrink-0 ml-auto opacity-50 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && reason && (
        <div className="px-3 py-1.5 text-xs text-neutral-500 border-l-2 border-yellow-500/20 ml-4 mt-1">
          {reason}
        </div>
      )}
    </div>
  );
}
```

Then in Activity.tsx:

```tsx
{run.status === 'skipped_precheck' ? (
  <SkipBadge reason={run.result_summary} />
) : run.error ? (
  <div className="...existing-error-styles...">
    <span>Error</span>
    <p>{run.error}</p>
  </div>
) : null}
```

---

## Verification

After deploying both changes:

```sql
-- Confirm no new skipped_precheck runs have error field populated
SELECT id, agent_role, status, error, result_summary
FROM agent_runs
WHERE status = 'skipped_precheck'
ORDER BY started_at DESC
LIMIT 10;
-- error should be NULL for all post-deploy runs
-- result_summary should contain "Precheck skip: ..."
```

In the Cockpit Activity UI:
- Existing old runs (pre-deploy) will still show red because their `run.error` is populated. Those will age out naturally.
- New skipped runs will show the yellow badge.
- Trigger a manual `health_check` or wait for the next scheduler cycle and confirm it renders as a skip badge, not a red error.

---

## What This Does NOT Change

- `preChecks.ts` — no changes. The skip logic and template regex stay as-is.
- `resolveModel.ts` — no changes. Deterministic routing stays as-is.
- `run.ts` — no changes. Scheduled task templates stay as-is.
- Actual errors still render red. Only `skipped_precheck` gets the neutral treatment.
