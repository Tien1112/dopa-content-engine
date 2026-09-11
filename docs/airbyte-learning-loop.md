# Airbyte and Claude learning loop

Airbyte owns source credentials and replication. The Dopa worker uses Airbyte
application client credentials to request a short-lived access token, triggers
only the configured connection ID, and follows the returned job ID. Raw source
tokens never enter Lovable, Claude or GitHub.

The destination normalizes source metrics into `content_performance_daily` and
links rows through `external_post_id`, `tracking_code`, `planned_post_id`,
`campaign_id`, `asset_file_id`, placement and product reference. Sync runs are
recorded in `ingestion_runs`; a successful Airbyte job is not equivalent to a
successful metric transformation.

`buildLearningSnapshot` produces a bounded 30-day evidence pack containing
totals, measured winners and current research signals. Claude combines those
two inputs into draft product and content proposals. It must name evidence and
uncertainty, and it cannot approve, schedule or publish its own proposals.

Airbyte Cloud requires an Application client ID and secret. Access tokens are
short-lived, so the client fetches a new token before control-plane calls.

## Meta: paid and organic stay separate at ingestion

All Meta results enter the warehouse through Airbyte:

- Facebook Marketing -> paid Facebook and Instagram campaign/ad insights.
- Facebook Pages -> ordinary Facebook Page posts and Page/post insights.
- Instagram -> professional-account media and organic media insights.

These are three separate Airbyte connections into the same BigQuery dataset.
Do not send organic Graph API results directly to the Hub: the normalization
step reads the Airbyte destination tables and only then writes the shared
`content_performance_daily` model. This keeps one auditable data route for
paid, organic and commerce performance.

## BigQuery to Hub bridge

The Railway Airbyte worker now performs the full hand-off after every successful
Airbyte sync. It reads the normalized BigQuery table, selects the rows for the
connection's provider and sends them in idempotent batches to the Hub data
gateway. Configure:

- `DOPA_BIGQUERY_PROJECT_ID=dopa-content-hub-507613`
- `DOPA_BIGQUERY_DATASET=dopa_airbyte`
- `DOPA_BIGQUERY_PERFORMANCE_TABLE=content_performance_daily`
- `DOPA_BIGQUERY_SERVICE_ACCOUNT_JSON` with the private service-account JSON

The BigQuery table or view must expose `provider`, `metric_date` and the Hub
metric columns. Source-specific Airbyte tables are transformed into this one
contract in BigQuery. If the service-account variable is absent, the worker can
still trigger and audit Airbyte jobs, but it deliberately imports zero analytics
rows and the Hub continues to report the missing data.

## Pinterest without Tailwind

Publishing is performed by the Hub scheduler and the Pinterest API worker. The
worker claims an approved job only when its planned time is due and creates the
Pin through Pinterest API v5. Organic Pin analytics must be replicated through
Airbyte into BigQuery as well; use the maintained Pinterest source when its
selected streams cover the required organic endpoints, otherwise use an
Airbyte Connector Builder source for `/v5/user_account/analytics` and Pin
analytics. Tailwind is not part of the production route.
# Dopa Google-bronnen

Voor Dopa lopen Google-resultaten via Airbyte en niet via tokens in de Hub.
De ondersteunde Google-bronnen zijn Google Analytics 4, Google Search Console,
Google Ads en Google Merchant Center. Een Google Bedrijfsprofiel blijft alleen
beschikbaar voor merken die klanten fysiek ontvangen of op locatie bedienen;
voor de volledig online Dopa-winkel wordt die bron niet geactiveerd.
