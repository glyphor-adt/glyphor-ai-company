# Prism Button Component Specification
**Version:** 2.0 (Pre-Launch Update)  
**Owner:** Design Department (Mia Tanaka)  
**Last Updated:** April 18, 2026  
**Status:** ACTIVE — All marketing surfaces and internal dashboards

---

## 1. CTA Hierarchy & Intent Mapping

### 1.1 Primary/Secondary/Tertiary Ordering
Varies by page depth, but always gates the highest-intent action for that stage.

| Variant | Intent | Usage Rule | Example CTAs (Pre-Launch) |
|---------|--------|------------|---------------------------|
| **Filled** (default) | "I am ready to commit." | Highest-intent action for the stage | "Request Early Access", "Join Waitlist", "Start Free Trial", "See the AI in Action" |
| **Outlined** | "I want to see proof." | Educational/proof actions | "Watch Demo", "Read the Specs", "View Case Studies" |
| **Ghost** | "I am navigating or reading." | Navigation, auxiliary actions, inline links | "Learn More", "Back to Home", "Documentation" |

### 1.2 Page-Specific Rules
- **Homepage & Global Nav**: Primary = strictly pipeline driver ("Request Early Access" or "Join Waitlist"). Secondary = educational/proof ("Watch Demo").
- **Feature Pages**: Primary can be contextual ("See the AI in Action"), but carries same visual weight as global primary.
- **Pricing**: Primary = bottom-funnel ("Start Free Trial", "Choose Plan").

---

## 2. Urgency/Scarcity CTAs (Pre-Launch Beta)

Since we are pre-launch with zero users, beta scarcity is our main conversion lever.

### 2.1 Visual Treatment Rules
- **NO** standard retail urgency (no cheap red, no aggressive flashing)
- **MUST** fit the Prism/Dark Glass aesthetic
- **Think** "controlled energy" — subtle, sophisticated, intentional

### 2.2 Implementation Options
1. **Subtle Accent Color Pulse**: Background gradient with 0.5s pulse animation
2. **Sweeping Border Gradient**: Animated border with gradient sweep (3s duration)
3. **Deliberate Glowing State**: Hover/focus state with increased glow and subtle scale

### 2.3 Example CTAs
- "Limited Beta Access"
- "Claim Your Spot"
- "Join Founding Cohort"
- "Secure Early Access"

---

## 3. Technical Implementation

### 3.1 Variants (CVA)
```typescript
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground",
        ghost: "hover:bg-muted hover:text-foreground",
        // ... existing variants
      },
      size: { ... }
    }
  }
)
```

### 3.2 Urgency Modifier (Optional)
```typescript
// Add to className when urgency is needed
const urgencyClasses = "bg-gradient-to-r from-primary/20 to-accent/20 border-accent/30 hover:border-accent/50 animate-pulse-subtle"
```

---

## 4. Accessibility Requirements

1. **Focus States**: Always visible 3px ring with 50% opacity
2. **Color Contrast**: Minimum 4.5:1 for text, 3:1 for UI components
3. **Animation**: Respects `prefers-reduced-motion` media query
4. **Screen Readers**: Proper aria-label for urgency CTAs ("Limited time offer")

---

## 5. Quality Gates

### 5.1 Design Review Checklist
- [ ] Intent mapping matches CTA hierarchy
- [ ] Urgency treatment aligns with Prism aesthetic
- [ ] No retail red or aggressive flashing
- [ ] Proper spacing and typography hierarchy
- [ ] Accessibility requirements met

### 5.2 Grading Scale
- **A+**: Indistinguishable from agency-grade urgency implementation
- **A**: Polished, intentional, fits Prism aesthetic
- **B**: Functional but lacks refinement
- **C**: Obvious quality gaps
- **F**: AI smell or retail urgency patterns

---

## 6. Change Log

| Date | Version | Change |
|------|---------|--------|
| Apr 18, 2026 | 2.0 | Added CTA hierarchy rules from marketing; defined urgency/scarcity treatment |
| Mar 15, 2026 | 1.2 | Updated accessibility requirements |
| Feb 28, 2026 | 1.1 | Added size variants and loading states |
| Feb 10, 2026 | 1.0 | Initial spec based on shadcn/ui |

---

**Approvals:**  
- Design: Mia Tanaka (VP Design)  
- Marketing: Maya Brooks (CMO)  
- Engineering: Marcus Reeves (CTO)