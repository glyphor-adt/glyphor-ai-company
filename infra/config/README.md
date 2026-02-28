# Vercel Configuration Template for Lighthouse Whitelisting

## Overview

This directory contains templates and guidance for configuring Vercel projects (Pulse and Fuse) to allow Google PageSpeed Insights / Lighthouse audits without rate limiting.

## Files

- `vercel-waf-template.json` - WAF rule template for IP whitelisting
- `vercel-firewall-config.md` - Step-by-step configuration guide
- `google-ips.json` - Current Google IP ranges (auto-updated)

## Quick Start

### Option 1: Vercel Dashboard (Recommended for Initial Setup)

1. **Navigate to project settings**
   - Pulse: https://vercel.com/[team]/pulse → Settings → Firewall
   - Fuse: https://vercel.com/[team]/fuse → Settings → Firewall

2. **Add Trusted IPs**
   - Go to "Trusted IPs" section
   - Click "Add Trusted IP"
   - Add Google IP ranges from `/infra/config/google-ips.json`
   - **Note**: Enter one CIDR block per entry (e.g., `8.8.8.0/24`)

3. **Test**
   - Run Lighthouse audit via agent tools
   - Verify no 429 errors

### Option 2: Vercel API (For Automation)

Use the Vercel API to programmatically update firewall configuration:

```bash
# Set your Vercel token
export VERCEL_TOKEN="your-token-here"
export VERCEL_PROJECT_ID="pulse-project-id"

# Fetch current config
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/firewall/config"

# Update trusted IPs
curl -X PATCH \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d @vercel-trusted-ips-payload.json \
  "https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/firewall/trusted-ips"
```

### Option 3: Terraform (Infrastructure as Code)

If using Terraform to manage Vercel configuration:

```hcl
# See vercel-terraform-example.tf for full example
resource "vercel_firewall_config" "pulse_firewall" {
  project_id = var.pulse_project_id
  
  trusted_ips = [
    for ip in local.google_ipv4_ranges : {
      value = ip
      note  = "Google PageSpeed Insights"
    }
  ]
}
```

## Maintenance

### Weekly Updates

Run the Google IP update script:

```bash
cd /path/to/glyphor-ai-company
./infra/scripts/update-google-ips.sh json > infra/config/google-ips.json
git add infra/config/google-ips.json
git commit -m "Update Google IP ranges"
git push
```

### Automated Updates (Recommended)

Set up a GitHub Action or Cloud Scheduler job:

1. Run `update-google-ips.sh` weekly
2. Commit changes to `google-ips.json`
3. Trigger Vercel deployment or API update
4. Alert on failures

See `.github/workflows/update-google-ips.yml` for automation example.

## Troubleshooting

### Still Getting 429 Errors?

1. **Check IP is whitelisted**
   ```bash
   # Get current trusted IPs from Vercel
   curl -H "Authorization: Bearer $VERCEL_TOKEN" \
     "https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/firewall/trusted-ips"
   ```

2. **Verify WAF rule order**
   - Trusted IP rules must come BEFORE rate-limiting rules
   - Check in Vercel Dashboard → Firewall → WAF

3. **Check Vercel logs**
   - Navigate to project → Logs
   - Filter for status code 429
   - Check source IP and compare with Google ranges

4. **Test from Google directly**
   ```bash
   # Test PageSpeed API
   curl -v "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://pulse.glyphor.ai"
   # Should return 200, not 429
   ```

### Google Changed Their IP Ranges?

Google updates their IP ranges periodically. If you see 429 errors after a period of working correctly:

1. Re-run `update-google-ips.sh`
2. Compare old and new IP ranges
3. Update Vercel configuration
4. Test Lighthouse audits

## Security Notes

### Risks

- Whitelisting all Google IPs is broad
- Could allow other Google services to bypass rate limits
- Potential for abuse if attackers use Google Cloud IPs

### Mitigations

1. **Monitor traffic**: Set up alerts for unusual patterns from whitelisted IPs
2. **Separate limits**: Consider applying lower rate limits to whitelisted IPs
3. **User-Agent verification**: Combine IP whitelisting with User-Agent checks
4. **Staging first**: Test on staging environment before applying to production

### Alternative: Reverse DNS Verification

For more security, consider implementing reverse DNS verification:
- All Google PageSpeed IPs resolve to `*.google.com` or `*.googlebot.com`
- More complex but more secure
- Requires custom middleware or edge function

## Resources

- [Vercel Firewall Documentation](https://vercel.com/docs/security/vercel-firewall)
- [Vercel Trusted IPs Guide](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/trusted-ips)
- [Google IP Ranges](https://www.gstatic.com/ipranges/goog.json)
- [Lighthouse Documentation](https://developers.google.com/speed/docs/insights/v5/get-started)

## Support

For questions or issues:
- **Engineering**: Post in #engineering Teams channel
- **Escalation**: Contact Marcus Chen (CTO)
- **Emergency**: Escalate to Sarah Chen (Chief of Staff)
