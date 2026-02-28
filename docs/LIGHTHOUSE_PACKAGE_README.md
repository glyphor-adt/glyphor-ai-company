# Lighthouse IP Whitelisting - Solution Package

This package contains all documentation, scripts, and automation needed to resolve HTTP 429 rate-limiting errors affecting Lighthouse audits for `pulse.glyphor.ai` and `fuse.glyphor.ai`.

## 📋 Problem Summary

VP Design (Mia Tanaka) and Design Critic (Sofia Marchetti) agents are unable to run automated Lighthouse audits because Google PageSpeed Insights requests are being rate-limited (HTTP 429) by Vercel's WAF.

## 🎯 Solution Overview

Whitelist Google's IP ranges in Vercel's firewall configuration to allow PageSpeed Insights API requests through without rate limiting.

## 📦 Package Contents

### Documentation
- **[LIGHTHOUSE_IP_WHITELIST.md](LIGHTHOUSE_IP_WHITELIST.md)** - Complete technical guide
  - Problem analysis and root cause
  - Google IP range sources and recommendations
  - Vercel configuration instructions
  - Security considerations and alternatives
  - Monitoring and verification steps

- **[IMPLEMENTATION_GUIDE_LIGHTHOUSE.md](IMPLEMENTATION_GUIDE_LIGHTHOUSE.md)** - Step-by-step implementation
  - Phase 1: Immediate fix (15-30 min)
  - Phase 2: Agent verification (5 min)
  - Phase 3: Automation setup (30 min)
  - Phase 4: Monitoring & maintenance (ongoing)
  - Troubleshooting guide
  - Rollback procedures

- **[LIGHTHOUSE_QUICKREF.md](LIGHTHOUSE_QUICKREF.md)** - Quick reference card
  - One-page summary for quick fixes
  - Suitable for sharing in Teams

### Scripts & Automation
- **[/infra/scripts/update-google-ips.sh](../infra/scripts/update-google-ips.sh)** - IP range fetcher
  - Fetches current Google IP ranges
  - Outputs in multiple formats (JSON, CIDR, Terraform, Vercel API)
  - Validates and counts IP ranges
  - Ready for automation

- **[/.github/workflows/update-google-ips.yml](../.github/workflows/update-google-ips.yml)** - GitHub Actions workflow
  - Runs weekly (Monday 6 AM UTC)
  - Fetches latest Google IP ranges
  - Creates PR when ranges change
  - Automated maintenance

### Configuration Templates
- **[/infra/config/README.md](../infra/config/README.md)** - Configuration guide
  - Multiple configuration approaches
  - Vercel dashboard, API, and Terraform examples
  - Maintenance procedures
  - Troubleshooting tips

- **[/infra/config/vercel-waf-template.json](../infra/config/vercel-waf-template.json)** - WAF rule template
  - Pre-configured rule structure
  - Ready to apply to Vercel

- **[/infra/config/google-ips.sample.json](../infra/config/google-ips.sample.json)** - Sample IP ranges
  - Example of expected format
  - Reference for testing

### Runbook Integration
- **[RUNBOOK.md](RUNBOOK.md)** - Updated troubleshooting section
  - Lighthouse 429 error diagnostic steps
  - Quick fix procedures
  - Verification queries

## 🚀 Quick Start

### For Marcus/Engineering (Implementation)

1. **Read the implementation guide**
   ```bash
   cat docs/IMPLEMENTATION_GUIDE_LIGHTHOUSE.md
   ```

2. **Fetch current Google IPs**
   ```bash
   ./infra/scripts/update-google-ips.sh json > google-ips.json
   ```

3. **Apply to Vercel**
   - Follow Phase 1 in Implementation Guide
   - Add IP ranges to Pulse and Fuse Trusted IPs

4. **Verify**
   - Test Lighthouse audits
   - Check for 429 errors in logs

**Time required**: ~1 hour initial setup

### For VP Design / Agents (Verification)

After implementation by Engineering:

1. **Test Lighthouse on Pulse**
   ```
   run_lighthouse(url: "https://pulse.glyphor.ai")
   ```

2. **Test Lighthouse on Fuse**
   ```
   run_lighthouse(url: "https://fuse.glyphor.ai")
   ```

3. **Verify no errors**
   - Check tool results
   - Should see performance scores, not 429 errors

4. **Report status**
   - Notify Chief of Staff (Sarah) of results
   - Log in activity feed

## 📊 Success Metrics

Implementation is successful when:
- ✅ No 429 errors for 7 consecutive days
- ✅ VP Design can run audits on both Pulse and Fuse
- ✅ Design Critic can run audits without failures
- ✅ Vercel logs show 200 status from Google IPs
- ✅ Weekly IP updates automated via GitHub Actions

## 🔄 Maintenance

### Weekly (Automated)
- GitHub Actions fetches latest Google IP ranges
- PR created automatically if ranges change
- Engineering reviews and merges PR
- IP ranges applied to Vercel

### Monthly (Manual)
- Review Lighthouse audit success rate
- Check for any recurring 429 errors
- Verify automation is working correctly

### Quarterly (Review)
- Assess effectiveness of whitelisting
- Consider alternative solutions if needed
- Update documentation as needed

## 🆘 Support

### Questions or Issues
- **Channel**: #engineering in Teams
- **Owner**: Marcus Chen (CTO)
- **Escalation**: Sarah Chen (Chief of Staff)

### Related Documentation
- [Operating Manual](OPERATING_MANUAL.md) - VP Design tools and capabilities
- [Architecture Guide](ARCHITECTURE.md) - System architecture
- [Runbook](RUNBOOK.md) - Operational procedures

## 📈 Next Steps

1. **Immediate** (Marcus/Engineering)
   - [ ] Review implementation guide
   - [ ] Apply IP whitelist to Vercel
   - [ ] Test and verify
   - [ ] Notify stakeholders

2. **This Week**
   - [ ] Monitor for 429 errors
   - [ ] Trigger GitHub Actions workflow
   - [ ] Verify automation works

3. **Ongoing**
   - [ ] Weekly monitoring
   - [ ] Merge IP update PRs
   - [ ] Maintain documentation

## 📝 Notes

- **Security**: Whitelisting all Google IPs is broad but necessary for PageSpeed Insights
- **Alternatives**: Reverse DNS verification or dedicated Lighthouse server (future consideration)
- **Automation**: GitHub Actions ensures IP ranges stay current
- **Monitoring**: Alerts configured for 429 errors to detect issues early

## 🏆 Impact

Resolving this issue will:
- ✅ Restore design quality monitoring capabilities
- ✅ Enable VP Design to perform automated audits
- ✅ Unblock Design Critic quality reviews
- ✅ Support pre-launch quality assurance for Pulse
- ✅ Maintain competitive design standards

---

**Last Updated**: 2026-02-28  
**Package Version**: 1.0  
**Status**: Ready for implementation
