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

- `DOPA_PINTEREST_CONFIG_JSON` plus either its referenced access-token variable
  or referenced Pinterest app client-ID and client-secret variables. For a
  Dopa-owned Pinterest app, the worker can request and cache an app-owner token
  with `boards:read,pins:write`, avoiding a monthly manual token replacement.
  Each account needs a reviewed Pinterest board ID and `pins:write` access. Image
  Pins publish directly; MP4 Pins use Pinterest's register-upload-process flow
  and require an approved HTTPS `cover_image_url` in the provider payload.
- `DOPA_ETSY_CONFIG_JSON` plus the referenced API-key, Etsy client-ID and OAuth
  refresh-token variables. A static access-token variable remains supported for
  one-shot diagnostics, but production should use `client_id_env` and
  `refresh_token_env`; the worker then refreshes Etsy's short-lived access token
  immediately before dispatch.
  Etsy creates a draft, uploads the QA-passed image and activates only when the
  approved provider payload explicitly contains `publish: true`.
- `DOPA_GOOGLE_BUSINESS_CONFIG_JSON` plus its referenced OAuth token variable.
  Each account needs an account ID, location ID and Business Manage scope.

Keep the corresponding Hub capability `not_connected` until a one-shot health
check and a separately approved real platform test succeed. Missing credentials
must stop the service instead of downgrading or silently rerouting content.
