# Railway channel publishers

The channel worker publishes only due Hub jobs that already passed the Hub's
revision approval, exact asset QA, planning, connection and idempotency gates.
It supports Pinterest image Pins, Etsy listings and standard Google Business
Profile posts. It never marks a job published without a real platform ID.

Deploy it as a separate Railway service with `Dockerfile.channel-publisher`
and `railway.channels.json`. Required shared private variables:

- `DOPA_PUBLISH_GATEWAY_URL`
- `DOPA_PUBLISH_WORKER_TOKEN`
- `DOPA_CHANNEL_PROVIDERS` — comma-separated subset of
  `pinterest,etsy,google_business_profile`
- `PUBLISH_POLL_INTERVAL_MS` — optional, default 5000

Provider-specific JSON config values reference environment-variable names;
they do not contain access tokens themselves:

- `DOPA_PINTEREST_CONFIG_JSON` plus its referenced token variable. Each
  account needs a reviewed Pinterest board ID and `pins:write` access.
- `DOPA_ETSY_CONFIG_JSON` plus referenced API key and OAuth token variables.
  Etsy creates a draft, uploads the QA-passed image and activates only when the
  approved provider payload explicitly contains `publish: true`.
- `DOPA_GOOGLE_BUSINESS_CONFIG_JSON` plus its referenced OAuth token variable.
  Each account needs an account ID, location ID and Business Manage scope.

Keep the corresponding Hub capability `not_connected` until a one-shot health
check and a separately approved real platform test succeed. Missing credentials
must stop the service instead of downgrading or silently rerouting content.
