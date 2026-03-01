# Implementation Guide for Marcus/Engineering

## Objective

Resolve HTTP 429 (Too Many Requests) errors affecting Lighthouse audits for `pulse.glyphor.ai` and `fuse.glyphor.ai`.

---

## Background

VP Design (Mia Tanaka) and Design Critic (Sofia Marchetti) agents run automated Lighthouse audits to monitor design quality. These audits are currently being rate-limited by Vercel's WAF, preventing the agents from performing their quality monitoring duties.

---

## Implementation Steps

### Phase 1: Immediate Fix (15-30 minutes)

#### Step 1: Fetch Current Google IP Ranges

```bash
# Clone this repo if not already done
git clone https://github.com/glyphor-adt/glyphor-ai-company.git
cd glyphor-ai-company

# Make script executable and run it
chmod +x infra/scripts/update-google-ips.sh
./infra/scripts/update-google-ips.sh json > google-ips-current.json

# Review the ranges
cat google-ips-current.json | jq -r '.ipv4_ranges[]' | head -20
```

**Expected Output**: List of ~100+ IPv4 CIDR ranges (e.g., `8.8.8.0/24`, `34.0.0.0/15`)

#### Step 2: Access Vercel Projects

1. Log in to Vercel: https://vercel.com/
2. Navigate to Pulse project
   - URL pattern: `https://vercel.com/[team-name]/pulse`
   - Or find via dashboard search
3. Navigate to Fuse project
   - URL pattern: `https://vercel.com/[team-name]/fuse`

#### Step 3: Configure Trusted IPs for Pulse

**Option A: Via Vercel Dashboard (Recommended for first-time)**

1. Open Pulse project in Vercel
2. Go to **Settings** → **Firewall**
3. Click on **"Trusted IPs"** section
4. Click **"Add Trusted IP"**
5. For each IP range in `google-ips-current.json`:
   - Enter the CIDR range (e.g., `8.8.8.0/24`)
   - Add a note: "Google PageSpeed Insights - Auto-updated [DATE]"
   - Click **"Add"**
6. Repeat for all IPv4 ranges (IPv6 may not be supported on all plans)
7. **Save changes**

**Option B: Via Vercel API (For automation)**

```bash
# Set environment variables
export VERCEL_TOKEN="your-vercel-token-here"
export PULSE_PROJECT_ID="your-pulse-project-id"

# Create payload from current Google IPs
jq -r '.ipv4_ranges[]' google-ips-current.json | \
  jq -R -s -c 'split("\n") | map(select(length > 0)) | map({value: ., note: "Google PageSpeed Insights"})' | \
  jq '{trustedIps: .}' > pulse-trusted-ips.json

# Apply to Vercel
curl -X PATCH \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d @pulse-trusted-ips.json \
  "https://api.vercel.com/v1/projects/$PULSE_PROJECT_ID/firewall/trusted-ips"
```

#### Step 4: Configure Trusted IPs for Fuse

Repeat Step 3 for the Fuse project.

#### Step 5: Verify Configuration

1. **Check Vercel Dashboard**
   - Navigate to Settings → Firewall → Trusted IPs
   - Confirm IP ranges are listed
   - Verify status shows "Active"

2. **Test Lighthouse Audit Manually**
   ```bash
   # Test from command line
   curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://pulse.glyphor.ai&strategy=desktop" | jq -r '.lighthouseResult.categories.performance.score'
   
   # Should return a number (0.0-1.0), not a 429 error
   ```

3. **Check Vercel Logs**
   - Go to Pulse/Fuse project → Logs
   - Filter last 1 hour
   - Look for requests from Google IPs
   - Verify status is 200, not 429

---

### Phase 2: Agent Verification (5 minutes)

#### Step 6: Test Via Agent Tools

Ask VP Design (Mia) or trigger a manual test:

**Via Dashboard Chat:**
```
Test Lighthouse audits on Pulse and Fuse to verify 429 errors are resolved.
```

**Via Cloud SQL (if direct access):**
```sql
-- Trigger VP Design agent run
INSERT INTO agent_tasks (agent_role, task, payload, status)
VALUES (
  'vp-design',
  'lighthouse_audit',
  '{"urls": ["https://pulse.glyphor.ai", "https://fuse.glyphor.ai"]}',
  'pending'
);
```

#### Step 7: Verify No 429 Errors

```sql
-- Check recent Lighthouse tool calls
SELECT 
  agent_role,
  tool_name,
  created_at,
  result::text
FROM activity_log
WHERE tool_name IN ('run_lighthouse', 'run_lighthouse_batch')
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Should see successful results, no "429" in result column
```

---

### Phase 3: Automation Setup (30 minutes)

#### Step 8: Enable GitHub Actions Workflow

The workflow `.github/workflows/update-google-ips.yml` is already created. To activate it:

1. **Verify workflow file exists**
   ```bash
   cat .github/workflows/update-google-ips.yml
   ```

2. **Push to main branch** (if not already)
   ```bash
   git pull origin main
   git checkout main
   git merge copilot/whitelist-agent-ip-ranges
   git push origin main
   ```

3. **Manually trigger first run**
   - Go to GitHub repository → Actions tab
   - Select "Update Google IP Ranges" workflow
   - Click "Run workflow" → "Run workflow"
   - Monitor execution

4. **Review the PR created**
   - The workflow will create a PR with updated IP ranges
   - Review the changes
   - Merge if acceptable

5. **Schedule weekly runs**
   - The workflow is already scheduled for Monday 6:00 AM UTC
   - No additional action needed
   - Workflow will create PRs automatically when Google updates their ranges

#### Step 9: Apply Automation to Vercel

**Option 1: Manual Process (Recommended Initially)**
- Wait for GitHub Action PR with updated IPs
- When PR is created, manually apply new IPs to Vercel
- Follow Steps 3-4 from Phase 1

**Option 2: Full Automation (Advanced)**
- Store Vercel API token in GitHub Secrets
- Modify workflow to call Vercel API directly
- Requires additional setup (not covered in this guide)

---

### Phase 4: Monitoring & Maintenance (Ongoing)

#### Step 10: Set Up Monitoring

**1. Create Vercel Alert for 429 Errors**
- In Vercel project settings
- Set up alert rule: `status_code == 429`
- Configure notification to #engineering channel

**2. Set Up Cloud SQL Query Dashboard**
```sql
-- Save as a query to run periodically
-- Run weekly to check for 429 errors
SELECT 
  DATE(created_at) as date,
  agent_role,
  COUNT(*) as failures
FROM activity_log
WHERE tool_name IN ('run_lighthouse', 'run_lighthouse_batch')
  AND result LIKE '%429%'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), agent_role
ORDER BY date DESC;
```

**3. Add to Weekly Ops Checklist**
- [ ] Check for new Google IP range update PRs
- [ ] Review Lighthouse audit success rate
- [ ] Verify no 429 errors in last 7 days

#### Step 11: Document Configuration

Update team documentation:
1. Add Vercel project credentials to password manager
2. Document IP whitelist configuration in Vercel project README
3. Add to team onboarding: "Lighthouse IP whitelisting is automated via GitHub Actions"

---

## Validation Checklist

After implementation, confirm:

- [ ] Google IP ranges fetched successfully
- [ ] IP ranges added to Pulse Vercel Trusted IPs
- [ ] IP ranges added to Fuse Vercel Trusted IPs
- [ ] Vercel shows Trusted IPs as "Active"
- [ ] Manual Lighthouse test succeeds (returns scores, not 429)
- [ ] Agent Lighthouse tools return successful results
- [ ] No 429 errors in Cloud SQL activity_log
- [ ] GitHub Actions workflow runs successfully
- [ ] Monitoring alerts configured
- [ ] Documentation updated

---

## Rollback Plan

If issues occur after implementation:

**Step 1: Remove Trusted IPs**
1. Go to Vercel project → Settings → Firewall → Trusted IPs
2. Remove all Google IP ranges
3. Verify site still functions normally

**Step 2: Revert to Previous Configuration**
1. Check Vercel's revision history
2. Roll back firewall configuration if needed

**Step 3: Notify Stakeholders**
1. Post to #engineering channel
2. Notify Mia (VP Design) that audits are paused
3. Escalate to Andrew/Kristina if blocking

---

## Troubleshooting

### Issue: Vercel doesn't have Trusted IPs feature

**Solution**: Use WAF rules instead
1. Go to Settings → Firewall → WAF
2. Create rule: "Allow Google PageSpeed"
3. Condition: IP address IN [Google ranges]
4. Action: Bypass rate limiting
5. Order rule BEFORE any rate-limiting rules

See: `/infra/config/vercel-waf-template.json` for example rule structure

### Issue: Too many IP ranges to add manually

**Solution**: Use Vercel API
- Follow Option B in Step 3
- Script will batch-add all ranges
- Takes ~30 seconds instead of hours

### Issue: Still getting 429 errors after whitelisting

**Diagnosis**:
1. Check Vercel logs for actual source IP of 429
2. Compare with Google IP ranges in `google-ips-current.json`
3. If IP not in list, Google may have added new ranges

**Solution**:
1. Re-run `update-google-ips.sh` to get latest ranges
2. Add any new ranges to Vercel
3. Test again

### Issue: GitHub Actions workflow fails

**Common causes**:
- Network access blocked
- jq not installed in runner
- Invalid JSON from Google

**Solution**:
1. Check workflow logs in GitHub Actions
2. Manually run script: `./infra/scripts/update-google-ips.sh json`
3. If manual works but Actions fails, may need to debug runner environment

---

## Time Estimates

- **Phase 1 (Immediate Fix)**: 15-30 minutes
- **Phase 2 (Verification)**: 5 minutes
- **Phase 3 (Automation)**: 30 minutes
- **Phase 4 (Monitoring)**: 10 minutes setup, ongoing maintenance

**Total Initial Time**: ~1 hour  
**Ongoing Time**: ~5 minutes per week

---

## Success Criteria

Implementation is successful when:

1. ✅ Lighthouse audits on Pulse return 200 status (not 429)
2. ✅ Lighthouse audits on Fuse return 200 status (not 429)
3. ✅ VP Design agent can run `run_lighthouse` tool without errors
4. ✅ Design Critic agent can run `run_lighthouse` tool without errors
5. ✅ No 429 errors in activity logs for 7 consecutive days
6. ✅ GitHub Actions creates weekly PRs for IP updates
7. ✅ Monitoring alerts configured and working

---

## Support & Escalation

- **Questions**: Post in #engineering Teams channel
- **Issues**: Tag Marcus Chen (CTO)
- **Urgent**: Escalate to Sarah Chen (Chief of Staff)

---

## References

- **Full Documentation**: `/docs/LIGHTHOUSE_IP_WHITELIST.md`
- **Configuration Guide**: `/infra/config/README.md`
- **Automation Script**: `/infra/scripts/update-google-ips.sh`
- **GitHub Workflow**: `/.github/workflows/update-google-ips.yml`
- **Runbook**: `/docs/RUNBOOK.md` (see "Lighthouse Rate Limiting" section)

---

**Last Updated**: 2026-02-28  
**Owner**: Marcus Chen (CTO)  
**Reviewers**: Andrew Zwelling (COO), Mia Tanaka (VP Design)
