# Lighthouse Audit IP Whitelisting Guide

## Problem Statement

Lighthouse audits for `pulse.glyphor.ai` and `fuse.glyphor.ai` are consistently returning HTTP 429 (Too Many Requests) errors. This is blocking design quality monitoring and automated auditing performed by the VP Design (Mia Tanaka) and Design Critic (Sofia Marchetti) agents.

## Root Cause

The issue stems from rate-limiting policies applied at the Vercel WAF/firewall level for the Pulse and Fuse product domains. Google PageSpeed Insights API (which powers Lighthouse audits) makes requests that are being throttled by these policies.

## Solution Overview

To resolve this issue, we need to:

1. **Whitelist Google PageSpeed Insights IP ranges** in Vercel's WAF configuration
2. **Configure rate-limiting exceptions** for automated audit tools
3. **Monitor and maintain** the IP allowlist as Google updates their ranges

---

## Google PageSpeed Insights IP Ranges

### Important Notes

- Google does **NOT** publish a static list of IPs specifically for PageSpeed Insights
- PageSpeed Insights requests come from Google's broader cloud infrastructure
- IP ranges are updated frequently and dynamically allocated

### Official IP Range Sources

Google provides aggregated IP range lists that should be used for whitelisting:

1. **Primary Source: All Google IPs**
   - URL: `https://www.gstatic.com/ipranges/goog.json`
   - Contains all publicly used Google IP ranges (APIs, bots, cloud services)
   - **RECOMMENDED**: Use this for comprehensive coverage

2. **Googlebot IPs** (subset, may not cover all PageSpeed requests)
   - URL: `https://developers.google.com/static/search/apis/ipranges/googlebot.json`
   - Covers Googlebot crawler ranges
   - May not include all PageSpeed infrastructure

3. **Google Cloud IPs** (customer-assignable ranges to exclude)
   - URL: `https://www.gstatic.com/ipranges/cloud.json`
   - Used to subtract customer IPs from the main list if needed

### Recommended Approach

**Option 1: Whitelist All Google IPs (Recommended)**
- Fetch from `https://www.gstatic.com/ipranges/goog.json`
- Parse the JSON and extract IPv4 and IPv6 prefixes
- Add all prefixes to Vercel Trusted IPs or WAF exceptions
- Update weekly or monthly via automation

**Option 2: Reverse DNS Verification**
- Instead of static IP whitelisting, verify requests using reverse DNS
- All PageSpeed IPs resolve to `*.googlebot.com` or `*.google.com`
- More complex but more secure and doesn't require IP list maintenance
- See: https://support.google.com/webmasters/answer/80553

---

## Vercel Configuration

### Prerequisites

- **Vercel Plan**: Pro or Enterprise (required for WAF and Trusted IPs features)
- **Project Access**: Admin access to `pulse.glyphor.ai` and `fuse.glyphor.ai` Vercel projects
- **Team**: Glyphor Pulse team and Glyphor Fuse team

### Step 1: Access Vercel Dashboard

1. Log in to Vercel: https://vercel.com/
2. Navigate to Pulse project: https://vercel.com/[team]/pulse
3. Navigate to Fuse project: https://vercel.com/[team]/fuse

### Step 2: Configure Trusted IPs (Recommended)

For each project (Pulse and Fuse):

1. Go to **Settings** → **Firewall** → **Trusted IPs**
2. Click **"Add Trusted IP"**
3. Add Google IP ranges from `goog.json`:
   - Download: `curl https://www.gstatic.com/ipranges/goog.json`
   - Extract IPv4 prefixes from the `prefixes` array
   - Add each CIDR range (e.g., `8.8.8.0/24`, `8.8.4.0/24`)
4. **Note**: Currently limited to IPv4 on most plans
5. Changes take effect immediately

### Step 3: Configure WAF Rate Limiting Exceptions (Alternative)

If Trusted IPs are not available or you need more granular control:

1. Go to **Settings** → **Firewall** → **WAF**
2. Create a new rule: **"Allow Google PageSpeed"**
3. Configure rule conditions:
   ```
   IF request.ip IN [Google IP ranges]
   THEN action = "bypass"
   ```
4. Order this rule BEFORE any rate-limiting rules
5. Save and deploy

### Example WAF Rule Structure

```json
{
  "name": "Allow Google PageSpeed Insights",
  "description": "Bypass rate limiting for Lighthouse audits",
  "enabled": true,
  "conditionGroup": [
    {
      "conditions": [
        {
          "type": "ip_address",
          "op": "inc",
          "value": [
            "8.8.8.0/24",
            "8.8.4.0/24",
            "... (add all Google IP ranges)"
          ]
        }
      ]
    }
  ],
  "action": {
    "type": "bypass"
  }
}
```

---

## Automation Script

Create a script to automatically fetch and update Google IP ranges:

See: `/infra/scripts/update-google-ips.sh` (to be created)

This script should:
1. Fetch `goog.json` from Google
2. Parse IPv4 and IPv6 prefixes
3. Update Vercel configuration via Vercel API
4. Run weekly via GitHub Actions or Cloud Scheduler

---

## Monitoring and Verification

### Test Lighthouse Access

After configuration, verify that Lighthouse audits work:

```bash
# Test from command line
curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://pulse.glyphor.ai&strategy=desktop"

# Check response status (should be 200, not 429)
```

### Monitor 429 Errors

1. **Vercel Logs**: Check Firewall logs for blocked requests
2. **Agent Logs**: Monitor VP Design and Design Critic agent tool execution logs
3. **Alert on 429s**: Set up monitoring to alert when Lighthouse tools return 429 errors

### Supabase Query for Agent Tool Failures

```sql
SELECT 
  agent_role,
  tool_name,
  created_at,
  result
FROM activity_log
WHERE tool_name IN ('run_lighthouse', 'run_lighthouse_batch')
  AND result LIKE '%429%'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

---

## Maintenance

### Weekly Tasks

- [ ] Verify Google IP list is up to date
- [ ] Check for any new 429 errors in agent logs
- [ ] Review Vercel Firewall logs for blocked Google requests

### Monthly Tasks

- [ ] Run automation script to update IP ranges
- [ ] Audit WAF rules for conflicts or ordering issues
- [ ] Review and optimize rate-limiting policies

### Quarterly Tasks

- [ ] Review alternative solutions (e.g., reverse DNS verification)
- [ ] Evaluate need for dedicated Lighthouse infrastructure
- [ ] Assess impact of whitelisting on security posture

---

## Alternative Solutions

If IP whitelisting proves insufficient or too broad:

### 1. Dedicated Lighthouse Server

Deploy a self-hosted Lighthouse instance:
- Run Lighthouse in a Docker container on GCP Cloud Run
- Configure with company credentials
- Eliminates need for IP whitelisting
- Full control over audit frequency and configuration

### 2. Lighthouse CI Service

Use Lighthouse CI or third-party services:
- Configure webhook endpoints that bypass rate limiting
- Integrate with GitHub Actions or Cloud Build
- More predictable IP ranges

### 3. User-Agent Based Allowlisting

If Vercel supports it, allow based on User-Agent:
- PageSpeed Insights uses a distinctive User-Agent
- Less secure than IP whitelisting but easier to maintain
- Verify User-Agent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/... Safari/537.36 PTST/...`

---

## Security Considerations

### Risks of Whitelisting All Google IPs

- **Broad allowlist**: Includes all Google services, not just PageSpeed
- **Potential abuse**: Attackers could use Google Cloud IPs to bypass rate limits
- **Reduces protection**: Weakens WAF effectiveness for legitimate threats

### Mitigation Strategies

1. **Combine with other signals**: Use User-Agent + IP verification
2. **Separate rate limits**: Apply lower rate limits to whitelisted IPs
3. **Monitor closely**: Alert on unusual traffic from whitelisted IPs
4. **Rotate secrets**: Don't expose sensitive APIs to public URLs
5. **Consider staging**: Test on staging environment first

---

## Implementation Checklist

### For Marcus/Engineering Team

- [ ] Access Vercel dashboard for Pulse and Fuse projects
- [ ] Verify current WAF and rate-limiting configuration
- [ ] Download Google IP ranges from `goog.json`
- [ ] Add IP ranges to Vercel Trusted IPs or WAF exceptions
- [ ] Test Lighthouse audits from PageSpeed Insights API
- [ ] Verify no 429 errors in Vercel logs
- [ ] Deploy IP update automation script
- [ ] Schedule weekly IP refresh job
- [ ] Document configuration in Vercel project settings
- [ ] Notify VP Design (Mia) and Chief of Staff (Sarah) when complete
- [ ] Monitor for 7 days to confirm resolution

### For VP Design (Mia Tanaka)

After implementation:
- [ ] Run Lighthouse audit on `pulse.glyphor.ai` via `run_lighthouse` tool
- [ ] Run Lighthouse audit on `fuse.glyphor.ai` via `run_lighthouse` tool
- [ ] Verify both return successful results (no 429 errors)
- [ ] Run batch audit via `run_lighthouse_batch` tool
- [ ] Report results to Chief of Staff (Sarah) for founder briefing

---

## References

- [Google IP Ranges JSON](https://www.gstatic.com/ipranges/goog.json)
- [Google Workspace IP Ranges Guide](https://support.google.com/a/answer/10026322)
- [Vercel Trusted IPs Documentation](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/trusted-ips)
- [Vercel WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- [Verify Googlebot IPs (Reverse DNS)](https://support.google.com/webmasters/answer/80553)

---

## Contact

**Issue Owner**: Marcus Chen (CTO)  
**Stakeholders**: Mia Tanaka (VP Design), Sofia Marchetti (Design Critic)  
**Reporter**: Sarah Chen (Chief of Staff)

For questions or assistance, escalate to #engineering channel in Teams.
