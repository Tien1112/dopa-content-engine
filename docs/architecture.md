# Proposed architecture

```text
manifest + packaged source
          |
          v
 package loader/schema validation
          |
          v
 preflight inspector ----> inspection report / visible failure
          |
          v
 rendering core (Playwright adapter)
          |
          v
 output artifact ----> QA verifier ----> qa-report.json
```

`src/core` owns domain types, configuration, inspection, rendering orchestration, and QA. Browser-specific work lives behind the Playwright renderer. Future FFmpeg animation capture, object storage, Claude MCP, and publishing integrations should be separate adapters that consume the same manifest and result contracts.

Presets live in `config/output-presets.json`. Brand and product profiles will live outside the core under `brands/` and `config/pod-profiles.json`; neither exists until a real profile is supplied.

The static slice uses one browser context per job, an exact viewport with device scale factor 1, local `file:` input, disabled animations for static capture, external-request blocking, explicit font/image readiness, and PNG QA.
