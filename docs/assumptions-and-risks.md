# Assumptions and risks

## Current assumptions

- A package declares its authored canvas dimensions.
- Static Phase 1 designs can load from a local `index.html` without a build step or server.
- Font expectations can be listed by CSS family name in `required_fonts`.
- External network access is unnecessary for deterministic production packages.

## Risks requiring real Claude exports

- Claude Design may generate bundler-specific paths, modules, blob URLs, remote assets, or runtime APIs.
- A loaded font can still differ by version even when its family name matches. File hashes should eventually be recorded.
- Browser font fallback detection is imperfect unless expected families/files are declared.
- JavaScript input can consume CPU or memory; the local slice has a navigation timeout but needs OS/container isolation for multi-tenant use.
- Responsive layouts may recompose at different viewports. The `exact` contract prevents accidental aspect-ratio conversion; future `contain` and `cover` require explicit composition rules.
- Pixel-level output can vary across Chromium, OS, GPU, and font-rendering versions. Production should pin container and browser versions and add golden-image tolerances.
