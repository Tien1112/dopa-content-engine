# Cloud Run renderer

The production renderer runs as a Cloud Run Job, not inside Claude or the
Lovable browser. The image contains the pinned Playwright Chromium runtime and
the deterministic Dopa CLI. A job receives a validated package through a
private mounted job directory and writes PNG/MP4 output plus its QA report back
to that directory. Uploading to canonical storage and updating Supabase remain
adapter responsibilities outside `src/core`.

## Image contract

- Image entrypoint: `node dist/src/cli.js`
- Default argument: `/jobs/manifest.json`
- Runtime user: unprivileged `pwuser`
- Writable job mount: `/jobs`
- Browser network: still blocked by the renderer preflight/runtime policy
- Success: process exit 0 only when the machine-readable QA report passes

Build locally:

```bash
docker build -t dopa-render-engine:local .
```

Run a packaged job from a local directory:

```bash
docker run --rm \
  --mount type=bind,src="$(pwd)/examples/static-design",dst=/jobs \
  dopa-render-engine:local /jobs/manifest.json
```

## Deployment boundary

The first hosted deployment needs a Google Cloud project, billing, an Artifact
Registry repository, a private job-input/output bucket or equivalent adapter,
and a service account with least-privilege access. Claude calls the Dopa MCP;
the MCP creates a database job record and invokes Cloud Run. It never sends
Google credentials or raw Meta/Shopify secrets to Claude or Lovable.

GitHub Actions should build, test, scan, and deploy the image. It is not the
production render worker.
