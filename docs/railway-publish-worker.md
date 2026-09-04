# Railway Meta publish worker

The Meta publisher is a separate Railway background service. It polls the
authenticated Hub gateway, receives only due and fully approved Meta jobs,
publishes through the existing Meta Graph adapter, and returns the real
platform receipt to the Hub.

Use `Dockerfile.publisher` with `railway.publisher.json`. Configure these
private Railway variables; never commit their values:

- `DOPA_PUBLISH_GATEWAY_URL` — production value:
  `https://dopa-content-hub.lovable.app/api/public/publish-worker`
- `DOPA_PUBLISH_WORKER_TOKEN` — the exact 48-character secret generated in
  Lovable Cloud for the gateway
- `DOPA_META_CONFIG_JSON` — private Meta adapter JSON as a Railway secret;
  alternatively `DOPA_META_CONFIG` can point to a privately mounted file
- `DOPA_META_ACCESS_TOKEN` — long-lived Meta Page access token referenced by
  the private adapter JSON
- `PUBLISH_POLL_INTERVAL_MS` — optional, defaults to `5000`
- `DOPA_META_INSTAGRAM_ACCOUNT_REF` — optional, defaults to `dopa-instagram`
- `DOPA_META_FACEBOOK_ACCOUNT_REF` — optional, defaults to `dopa-facebook`

The private adapter JSON follows `config/meta-adapter.example.json` and needs
the real Instagram Professional Account ID and Facebook Page ID. It contains
the environment-variable name, never the token value.

The Hub must keep Instagram and Facebook `not_connected` until a real token,
account IDs, required permissions, and a live end-to-end test have succeeded.
The first worker release supports Instagram feed/square images, Instagram
Reels, and Facebook feed/landscape image posts. Stories and Facebook Reels are
blocked by the Hub until their adapters have separate proof.

For a one-shot connectivity check set `PUBLISH_ONCE=1`; the worker validates
the gateway health and exits after one claim attempt. Never create a live test
post without explicit approval of the exact asset, copy, account, and time.
