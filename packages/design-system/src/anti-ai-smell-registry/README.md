# Anti-AI-Smell Component Registry

This registry enforces human-grade aesthetic tokens and prevents common AI-generated design patterns (e.g., "the blur", overly saturated gradients, unbalanced whitespace).

## Core Principles
1. **Aesthetic Restraint:** Single accent color, structural layouts.
2. **Typographic Hierarchy:** Strict enforcement of size and weight rules.
3. **Spacing:** Mathematical spacing (4px baseline grid).
4. **Token Enforcement:** Hard fail on unauthorized colors or padding outside the token scale.

## Implementation
This directory will contain the specific component overrides and linting rules required to enforce these standards across all Glyphor-generated builds.
