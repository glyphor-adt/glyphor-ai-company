# Authority Model

The authority model controls what actions AI agents can take autonomously versus what requires human founder approval.

## Decision Tiers

### 🟢 Green — Autonomous

Agents execute immediately. No approval required. All actions are logged.

**Examples by agent:**
- **Chief of Staff**: compile briefing, route decision, log activity, generate briefing
- **CTO**: model fallback, cache optimization, staging deploy, health check
- **CFO**: cost tracking, standard reports, margin calculation
- **CPO**: usage analysis, competitive scan, feature prioritization
- **CMO**: blog posts, social posts, SEO analysis, content calendar
- **VP CS**: health scoring, nurture emails, segment updates
- **VP Sales**: account research, ROI calculator, market sizing

### 🟡 Yellow — One Founder Required

Teams notification sent to assigned founder. Action queued until approval.
Auto-reminder after 4 hours if no response.

| Action | Assigned To |
|--------|-------------|
| Costly model switch | Andrew |
| Roadmap priority change | Kristina |
| Enterprise outreach | Kristina |
| Content strategy shift | Kristina |
| Costly infra scaling | Andrew |
| Publish competitive analysis | Kristina |
| Production deploy | Andrew |

### 🔴 Red — Both Founders Required

Teams notification sent to both Kristina and Andrew. Both must approve.

- New product proposals
- Pricing changes
- Architecture shifts
- Large enterprise deals
- Brand positioning changes
- Budget reallocation
- Agent roster changes
- High-cost commitments

## Default Behavior

Unknown actions not explicitly mapped default to **Yellow** and are assigned to both founders. This prevents agents from taking unmapped actions without human oversight.

## Decision Queue Workflow

1. Agent proposes action
2. Authority gate checks tier
3. If Green → execute immediately
4. If Yellow/Red → create decision record, notify founder(s) via Teams
5. Founder approves/rejects via Teams or dashboard
6. If approved → action executes
7. If rejected → logged with reason, agent notified
8. Auto-reminder at 4-hour intervals for pending decisions
