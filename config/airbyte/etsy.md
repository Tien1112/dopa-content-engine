# Etsy to Airbyte

This Connector Builder source keeps Etsy credentials inside Airbyte and sends
shop receipts and active listings to the existing Dopa BigQuery destination.
It is read-only. Publishing remains the separate approval-gated Hub worker.

## Required source values

- `shop_id`: the numeric Etsy shop ID.
- `api_key`: Etsy `keystring:shared_secret`; stored as an Airbyte secret.
- `client_id`: the Etsy keystring used for OAuth refresh.
- `refresh_token`: the seller OAuth refresh token; stored as an Airbyte secret.
- `start_timestamp`: earliest order date as Unix seconds.

The OAuth grant must include `transactions_r` for receipts and `listings_r` for
private listing access. Airbyte refreshes the one-hour access token through
Etsy's token endpoint. Never put any of these values in GitHub, Lovable, Claude
or the manifest itself.

Connect both streams to the existing Dopa BigQuery destination. Use append with
dedupe and the declared primary keys. Run an initial manual sync, then deploy
`config/bigquery/content-performance.sql`. Etsy only counts as live after a real
receipt is visible in the normalized view and imported into the Hub.

The current performance view treats a paid, non-cancelled receipt as one gross
order and uses `grandtotal` as gross revenue. Refund-aware net revenue should be
added from Etsy payments/ledger data before using the view for accounting.
