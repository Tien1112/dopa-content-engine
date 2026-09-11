# Meta organic analytics worker

The Meta Ads Airbyte source only covers paid marketing. This separate read-only
worker collects the performance of ordinary Facebook Page posts and Instagram
professional-account media through Meta Graph API v25.0 and sends daily
snapshots to the Hub data gateway.

Collected fields include Facebook impressions, reach, engaged users, clicks
and video views, plus Instagram reach, total interactions, saves, shares and
views/plays. Unsupported metrics for a particular Instagram media type are
stored as zero without failing the other metrics. The Hub links a snapshot to
the planned post through the external Meta post id where possible; historic
posts remain available as unmatched evidence.

Required private Railway variables:

- `DOPA_META_CONFIG_JSON`
- `DOPA_META_ACCESS_TOKEN`
- `DOPA_DATA_GATEWAY_URL`
- `DOPA_DATA_WORKER_TOKEN`

Optional variables:

- `DOPA_META_FACEBOOK_ACCOUNT_REF` (default `dopa-facebook`)
- `DOPA_META_INSTAGRAM_ACCOUNT_REF` (default `dopa-instagram`)
- `META_ORGANIC_WINDOW_DAYS` (default 30, maximum 90)
- `META_ORGANIC_SYNC_INTERVAL_MS` (default 24 hours, minimum 1 hour)
- `META_ORGANIC_ONCE=1` for a one-off verification run

Deploy it as a separate Railway service with `Dockerfile.meta-organic`. The
Meta token must grant read access to the Dopa Facebook Page and linked
Instagram professional account. Tokens never enter Lovable, Claude or GitHub.
