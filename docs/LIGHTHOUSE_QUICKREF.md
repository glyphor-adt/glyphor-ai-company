# Lighthouse 429 Error - Quick Reference

## 🚨 Problem
Lighthouse audits for `pulse.glyphor.ai` and `fuse.glyphor.ai` return HTTP 429 (rate limited)

## ⚡ Quick Fix (Marcus/Engineering)

### 1. Get Google IPs
```bash
cd glyphor-ai-company
./infra/scripts/update-google-ips.sh json > ips.json
```

### 2. Add to Vercel
- Open https://vercel.com → Pulse project
- Settings → Firewall → Trusted IPs
- Add each IP range from `ips.json`
- Repeat for Fuse project

### 3. Test
```bash
curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://pulse.glyphor.ai"
# Should return scores, not 429
```

## 📚 Full Documentation
- [Complete Guide](/docs/LIGHTHOUSE_IP_WHITELIST.md)
- [Implementation Steps](/docs/IMPLEMENTATION_GUIDE_LIGHTHOUSE.md)
- [Runbook Troubleshooting](/docs/RUNBOOK.md#lighthouse-rate-limiting-http-429)

## ⏰ Time Required
- Initial setup: 30 minutes
- Verification: 5 minutes
- Weekly maintenance: automated via GitHub Actions

## ✅ Success Criteria
- [ ] No 429 errors in Lighthouse audits
- [ ] VP Design can run audits successfully
- [ ] Vercel logs show 200 status from Google IPs

## 🆘 Need Help?
- Post in #engineering
- Tag @Marcus Chen (CTO)
- Emergency: Escalate to @Sarah Chen (CoS)
