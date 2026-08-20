# Dopa Render Engine guardrails

Claude is the creative source; this repository is the deterministic production-output authority. Preserve approved composition and do not introduce generative redesign into the renderer.

## Architectural rules

- Keep brand configuration outside `src/core`; the renderer must support arbitrary brands.
- Never silently stretch a design, substitute a font, ignore a missing asset, or permit an unapproved network dependency.
- Inspect every package before rendering. Treat its HTML and JavaScript as untrusted.
- Keep output dimensions in configuration, not scattered through implementation code.
- A render is successful only after the output file passes machine-readable QA.
- Keep integrations (Claude MCP, Shopify, social publishers, Printful, Gelato) behind future adapters. Do not couple them to the rendering core.
- Do not use PDF as the canonical source and do not require Canva or a paid rendering service.

## Phase 1 boundary

The first vertical slice is static HTML to an exact-size PNG through Playwright/Chromium, followed by PNG and resource QA. Animation, `contain`/`cover` composition, POD profiles, remote handoffs, and publishing remain later milestones until separately proven with real inputs.

## Verification

Run `npm test` and `npm run render:example`. Do not claim rendering success based on type-checking alone; inspect the generated PNG and `qa-report.json`.
