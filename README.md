# Dopa Render Engine

A deterministic production rendering layer for approved Claude Design exports. Claude remains the creative cockpit; this service turns packaged HTML into validated production assets without redesigning it.

## Phase 1 status

The current vertical slice supports one static `exact` PNG output. It performs a package preflight, blocks external network requests, waits for document fonts and images, captures through Chromium, and validates the resulting PNG dimensions, format, file size, and required resource state. Animation, POD, `contain`, and `cover` are specified as follow-on work and are not silently approximated.

## Requirements

- Node.js 22+
- Playwright's Chromium build

```bash
npm install
npx playwright install chromium
npm test
npm run render:example
```

Run a package directly:

```bash
npm run build
node dist/src/cli.js ./examples/static-design/manifest.json
```

The example writes `examples/static-design/renders/instagram_feed.png` and `qa-report.json`. Once installed globally or linked, the intended command is:

```bash
dopa-render ./examples/static-design/manifest.json
```

## Canonical input

```text
content-job/
  manifest.json
  source/
    index.html
    assets/
    fonts/
```

Paths must stay inside the package. The current renderer forbids remote HTTP(S) dependencies by default. Use `required_fonts` to turn font fidelity expectations into explicit checks.

## Rendering contract

- `exact`: source canvas and output dimensions must match. This is the implemented Phase 1 mode.
- `contain`: future compositor mode; preserve the whole composition with possible letterboxing.
- `cover`: future compositor mode; fill the canvas with explicit cropping risk.

Unsupported modes fail visibly. A renderer must never stretch one aspect ratio into another.

See [architecture](docs/architecture.md), [assumptions and risks](docs/assumptions-and-risks.md), [threat model](docs/threat-model.md), and [acceptance tests](docs/phase-1-acceptance-tests.md).
