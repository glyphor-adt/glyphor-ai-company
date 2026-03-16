---
name: elite-design-review
slug: elite-design-review
category: design
description: Run strict pass/fail quality gating for web builds using automated checks first, then a 100-point design rubric with structured feedback and learning capture. Use for pre-ship review of any website or web app output.
holders: design-critic, vp-design, ui-ux-designer
tools_granted: check_ai_smell, run_accessibility_audit, screenshot_page, compare_screenshots, run_lighthouse_audit, save_memory, send_agent_message
version: 1
---

# Elite Design Review

This is Glyphor's hard quality gate for web builds. Nothing ships without passing automated checks and clearing a 90+ score on the rubric.

## Step 1 - Automated Pre-Checks (Pass/Fail)

Run these before any subjective scoring:

1. `check_ai_smell`
- Any flag means automatic revision required.

2. `run_accessibility_audit`
- Any WCAG AA failure means automatic block.

3. `screenshot_page` at 1440, 1024, 768, and 375 widths
- Any breakpoint layout break means automatic revision.

If any pre-check fails, stop scoring and return fix instructions.

## Step 2 - 100-Point Rubric

## 1. Visual Distinction (25 points)

- 22-25: Memorable point of view, clear visual authorship, instantly identifiable style.
- 16-21: Strong but partially familiar patterns; still differentiated.
- 10-15: Functional but generic feel; low memorability.
- 0-9: Cookie-cutter layout/aesthetic with obvious AI-template feel.

## 2. Technical Execution (25 points)

- 22-25: Responsive at all required breakpoints, clean architecture, smooth rendering, no implementation defects.
- 16-21: Minor implementation issues not blocking use.
- 10-15: Noticeable quality defects or weak responsiveness.
- 0-9: Broken layouts, unstable behavior, or significant technical regressions.

## 3. Typography (20 points)

- 18-20: Strong hierarchy, intentional display/body pairing, readable body rhythm.
- 13-17: Good hierarchy with minor scale/weight inconsistencies.
- 8-12: Weak hierarchy or timid scale choices.
- 0-7: Flat, generic, or inconsistent typography.

## 4. Interaction and Animation (15 points)

- 13-15: Purposeful choreography, crisp micro-interactions, clear feedback loops.
- 10-12: Solid interactions with limited choreography depth.
- 6-9: Sparse or inconsistent interaction feedback.
- 0-5: Motion missing, distracting, or unjustified.

## 5. Accessibility (15 points)

- 14-15: WCAG AA clean, keyboard complete, focus handling and reduced-motion support are correct.
- 10-13: Minor non-blocking issues with clear remediation path.
- 6-9: Multiple accessibility defects affecting usability.
- 0-5: Fails baseline accessibility expectations.

## Step 3 - Verdict Rules

- 90-100: Ship it.
- 75-89: Almost there. Return targeted revisions (max 2 rounds at this tier).
- 60-74: Significant work needed.
- Below 60: Restart creative direction with a new brief.

## Feedback Format (Required)

Every feedback item must include:

1. Component name
2. Property to change
3. Current value -> target value
4. Expected score impact

Example:

- Component: Hero
- Property: Heading scale
- Change: text-4xl -> text-6xl font-black
- Expected impact: +3 visual distinction

## Post-Ship Learning Loop (90+ Builds)

After any shipped build scoring 90+:

1. Save memory entry with:
- Full design contract/brief
- Score breakdown by dimension
- Strengths that drove the score
- Revisions that improved score
- Pulse prompts/assets that worked

2. Update ux-engineer skill references with:
- Proven patterns
- Common deductions to avoid

3. Persist structured review rounds:
- Issue
- Fix
- Impact delta
- Resolution status

This is mandatory to prevent repeated quality regressions.
