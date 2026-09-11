-- Deployed in dopa-content-hub-507613.dopa_airbyte on 2026-09-11.
-- Future Airbyte channel transforms are added to this contract with UNION ALL.
CREATE OR REPLACE VIEW `dopa-content-hub-507613.dopa_airbyte.content_performance_daily` AS
SELECT
  'shopify' AS provider,
  DATE(created_at, 'Europe/Amsterdam') AS metric_date,
  COALESCE(
    NULLIF(REGEXP_EXTRACT(landing_site, r'(?i)[?&]utm_source=([^&]+)'), ''),
    'shopify_order'
  ) AS placement_key,
  CAST(NULL AS STRING) AS external_post_id,
  NULLIF(REGEXP_EXTRACT(landing_site, r'(?i)[?&]utm_content=([^&]+)'), '') AS tracking_code,
  CAST(NULL AS STRING) AS product_ref,
  0 AS impressions,
  0 AS reach,
  0 AS engagements,
  0 AS saves,
  0 AS clicks,
  0 AS video_views,
  0 AS ad_spend_cents,
  1 AS orders,
  CAST(ROUND(COALESCE(total_price, 0) * 100) AS INT64) AS revenue_cents
FROM `dopa-content-hub-507613.dopa_airbyte.orders`
WHERE created_at IS NOT NULL
  AND cancelled_at IS NULL
  AND COALESCE(test, FALSE) = FALSE;
