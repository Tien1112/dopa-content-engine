# Threat model

Input HTML, CSS, JavaScript, fonts, and assets are untrusted. They may attempt network exfiltration, local-file reads, infinite computation, browser exploitation, or excessive resource use.

The local proof blocks HTTP(S), WebSocket, and other non-local requests, rejects paths escaping the package, runs a fresh context, sets timeouts, and closes the browser after each job. These are defense-in-depth measures, not a complete sandbox.

A production worker must additionally run as an unprivileged user in an ephemeral container/VM with a read-only source mount, a dedicated writable output directory, Chromium sandbox enabled, no ambient credentials, no network by default, CPU/memory/process/file-size limits, a hard wall-clock kill, pinned dependencies, security updates, and destruction of the worker after each job. Browser `--no-sandbox` must not be used.
