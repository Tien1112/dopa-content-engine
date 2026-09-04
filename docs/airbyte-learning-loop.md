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
