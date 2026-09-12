# Facebook organic via Airbyte

Import `facebook-organic-manifest.yaml` in Airbyte Connector Builder and create a
source named `Dopa Facebook Organic` with:

- Page ID: `1043154442224823`
- Page access token: the same secret stored as `DOPA_META_ACCESS_TOKEN` in Railway
- Start date: the earliest date that should contribute to the learning loop

Never commit or paste the access token into this repository. In Airbyte it is a
secret field. Select both streams and replicate them to the existing `Dopa
BigQuery` destination. Use a 24-hour schedule and append/deduplicate on the
declared primary keys.

After the first successful sync, deploy
`config/bigquery/content-performance.sql`. Then add the Airbyte connection ID to
the worker route as provider `facebook` and scope `organic`. A provider is only
live after at least one post and its insight rows appear in
`content_performance_daily`.
