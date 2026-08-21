# Dopa Render Engine

A deterministic production rendering layer for approved Claude Design exports. Claude remains the creative cockpit; this service turns packaged HTML into validated production assets without redesigning it.

## Phase 1 status

The current vertical slice supports static `exact` PNG output, including multi-page Claude Design exports where every approved canvas is a separate HTML element. It performs a package preflight, blocks external network requests, waits for document fonts and images, captures through Chromium, and validates every resulting PNG's dimensions, format, file size, and required resource state. Animation, POD, `contain`, and `cover` are specified as follow-on work and are not silently approximated.

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

Prepare a downloaded Claude Design ZIP without executing files from the archive:

```bash
npm run build
node dist/src/cli.js prepare-claude-zip "/path/to/design.zip" "/path/to/prepared-jobs" "brand-slug"
```

The adapter validates archive paths, selects the single self-contained bundled HTML export, inventories its approved canvases, and creates a bounded multi-page square job. If the ZIP contains approved 2:3 PNG compositions, it also creates a Pinterest job that proportionally reduces them to 1000×1500 without changing their aspect ratio. It reports absent 4:5 and 9:16 compositions instead of manufacturing or stretching them.

## GitHub render proof

`.github/workflows/render-qa.yml` runs the test suite in a clean Linux environment, installs the pinned Playwright Chromium build, renders the single- and multi-page proofs, checks every machine-readable QA result, and uploads PNGs plus contact sheets as the `render-qa-evidence` artifact. The committed CI fixture is generated at runtime and contains no Dopa production artwork.

The real Dopa ZIP remains outside the repository unless its owner explicitly approves publishing those assets. Run the same prepare/render commands against that ZIP locally or in an approved private asset environment, then visually approve its contact sheets.

## Approved eye-animation proof

The eye-animation proof is a separate, input-specific milestone and does not change the static Phase 1 renderer. It validates the supplied Claude Design ZIP, verifies the approved `Eye Loop 3a` source contract, reproduces its vector motion deterministically, and exports exact-size MP4s plus a transparent WebM with machine-readable QA.

```bash
npm run proof:eye-animation -- "/path/to/Moving eye with eyelashes.zip" work/dopa-eye-animation-proof
```

The generated `index.html` is a self-contained review surface with playback and download links for the original 1080×900 canvas, Instagram/Facebook feed, story/reel, square, and Pinterest. The supplied artwork and generated media remain local and are not committed.

## Content planning foundation

The channel-neutral planning contract lives outside the renderer in `src/publishing`. The local stdio MCP server in `src/mcp` lets Claude Desktop create versioned drafts, read them back, require separate approval and queue confirmations, and place exact approved items in an idempotent per-channel outbox. No live publishing credentials or APIs are coupled to `src/core`. See [content planning and publishing](docs/content-planning.md), [Claude Desktop setup](docs/claude-content-planner.md), and the machine-readable [content-plan schema](schemas/content-plan.schema.json).

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

For an export containing multiple approved canvases, add a bounded page selector:

```json
{
  "canvas": { "width": 1080, "height": 1080 },
  "pages": {
    "selector": "[data-document-role=page]",
    "label_attribute": "data-label",
    "maximum": 100
  }
}
```

The renderer captures each matched element separately and includes the normalized page label in its filename and QA record. Every matched element must have the declared canvas dimensions.

## Rendering contract

- `exact`: source canvas and output dimensions must match. This is the implemented Phase 1 mode.
- `contain`: future compositor mode; preserve the whole composition with possible letterboxing.
- `cover`: future compositor mode; fill the canvas with explicit cropping risk.

Unsupported modes fail visibly. A renderer must never stretch one aspect ratio into another.

See [architecture](docs/architecture.md), [assumptions and risks](docs/assumptions-and-risks.md), [threat model](docs/threat-model.md), and [acceptance tests](docs/phase-1-acceptance-tests.md).
