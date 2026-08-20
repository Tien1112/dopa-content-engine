# Phase 1 acceptance tests

## Static vertical slice (implemented)

1. A valid 1080x1350 package renders an actual non-empty PNG.
2. PNG IHDR reports exactly 1080x1350 and format `png`.
3. Missing local assets fail the job and appear in the QA report.
4. An undeclared/blocked external dependency fails preflight or rendering.
5. A required font that is unavailable fails the job.
6. A source/output dimension mismatch in `exact` mode fails instead of stretching.
7. Traversal outside the package is rejected.
8. A machine-readable `qa-report.json` is always written after rendering starts, including failures.

## Remaining Phase 1 acceptance tests

- All five social presets render against approved compositions at their declared sizes.
- An animated export produces a 1080x1920 H.264 MP4 with configured duration/frame rate and verified stream metadata.
- A configurable POD profile produces an exact-size PNG whose color type contains alpha and whose background remains transparent.
- A representative real Claude Design static, animated, and transparent export passes inspection and visual approval.
