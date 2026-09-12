-- Canonical Dopa performance contract for the Hub strategy loop.
-- Airbyte owns ingestion; this view normalizes paid, organic and commerce data.
CREATE OR REPLACE VIEW `dopa-content-hub-507613.dopa_airbyte.content_performance_daily` AS

WITH meta_paid_rows AS (
  SELECT
    CASE WHEN publisher_platform = 'instagram' THEN 'instagram' ELSE 'facebook' END AS provider,
    date_start AS metric_date,
    CONCAT(
      CASE WHEN publisher_platform = 'instagram' THEN 'instagram' ELSE 'facebook' END,
      '_', COALESCE(NULLIF(platform_position, ''), 'unknown'), '_paid'
    ) AS placement_key,
    ad_id AS external_post_id,
    ad_id AS tracking_code,
    CAST(NULL AS STRING) AS product_ref,
    COALESCE(impressions, 0) AS impressions,
    COALESCE(reach, 0) AS reach,
    COALESCE(inline_post_engagement, 0) AS engagements,
    CAST(COALESCE((
      SELECT MAX(SAFE_CAST(JSON_VALUE(action, '$.value') AS NUMERIC))
      FROM UNNEST(IFNULL(JSON_QUERY_ARRAY(actions), [])) AS action
      WHERE JSON_VALUE(action, '$.action_type') = 'post_save'
    ), 0) AS INT64) AS saves,
    COALESCE(clicks, 0) AS clicks,
    CAST(COALESCE((
      SELECT MAX(SAFE_CAST(JSON_VALUE(action, '$.value') AS NUMERIC))
      FROM UNNEST(IFNULL(JSON_QUERY_ARRAY(video_play_actions), [])) AS action
      WHERE JSON_VALUE(action, '$.action_type') IN ('video_view', 'video_play')
    ), 0) AS INT64) AS video_views,
    CAST(ROUND(COALESCE(spend, 0) * 100) AS INT64) AS ad_spend_cents,
    CAST(COALESCE((
      SELECT MAX(SAFE_CAST(JSON_VALUE(action, '$.value') AS NUMERIC))
      FROM UNNEST(IFNULL(JSON_QUERY_ARRAY(actions), [])) AS action
      WHERE JSON_VALUE(action, '$.action_type') IN (
        'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'
      )
    ), 0) AS INT64) AS orders,
    CAST(ROUND(COALESCE((
      SELECT MAX(SAFE_CAST(JSON_VALUE(action, '$.value') AS NUMERIC))
      FROM UNNEST(IFNULL(JSON_QUERY_ARRAY(action_values), [])) AS action
      WHERE JSON_VALUE(action, '$.action_type') IN (
        'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'
      )
    ), 0) * 100) AS INT64) AS revenue_cents
  FROM `dopa-content-hub-507613.dopa_airbyte.meta_ads_insights_platform_and_device`
  WHERE date_start IS NOT NULL
),

meta_paid AS (
  SELECT
    provider, metric_date, placement_key, external_post_id, tracking_code, product_ref,
    SUM(impressions) AS impressions,
    SUM(reach) AS reach,
    SUM(engagements) AS engagements,
    SUM(saves) AS saves,
    SUM(clicks) AS clicks,
    SUM(video_views) AS video_views,
    SUM(ad_spend_cents) AS ad_spend_cents,
    SUM(orders) AS orders,
    SUM(revenue_cents) AS revenue_cents
  FROM meta_paid_rows
  GROUP BY provider, metric_date, placement_key, external_post_id, tracking_code, product_ref
),

instagram_organic AS (
  SELECT
    'instagram' AS provider,
    DATE(COALESCE(insights.timestamp, media.timestamp), 'Europe/Amsterdam') AS metric_date,
    CASE
      WHEN UPPER(COALESCE(media.media_product_type, '')) = 'REELS' THEN 'instagram_reel_organic'
      ELSE 'instagram_feed_organic'
    END AS placement_key,
    insights.id AS external_post_id,
    NULLIF(REGEXP_EXTRACT(media.caption, r'(?i)(?:code|utm_content)[:= ]+([A-Za-z0-9_-]+)'), '') AS tracking_code,
    CAST(NULL AS STRING) AS product_ref,
    COALESCE(insights.views, 0) AS impressions,
    COALESCE(insights.reach, 0) AS reach,
    COALESCE(
      insights.total_interactions,
      COALESCE(insights.likes, 0) + COALESCE(insights.comments, 0)
        + COALESCE(insights.saved, 0) + COALESCE(insights.shares, 0)
    ) AS engagements,
    COALESCE(insights.saved, 0) AS saves,
    0 AS clicks,
    CASE WHEN UPPER(COALESCE(media.media_type, '')) = 'VIDEO' THEN COALESCE(insights.views, 0) ELSE 0 END AS video_views,
    0 AS ad_spend_cents,
    0 AS orders,
    0 AS revenue_cents
  FROM `dopa-content-hub-507613.dopa_airbyte.instagram_media_insights` AS insights
  LEFT JOIN `dopa-content-hub-507613.dopa_airbyte.instagram_media` AS media USING (id)
  WHERE COALESCE(insights.timestamp, media.timestamp) IS NOT NULL
),

instagram_stories AS (
  SELECT
    'instagram' AS provider,
    DATE(story.timestamp, 'Europe/Amsterdam') AS metric_date,
    'instagram_story_organic' AS placement_key,
    insights.id AS external_post_id,
    CAST(NULL AS STRING) AS tracking_code,
    CAST(NULL AS STRING) AS product_ref,
    COALESCE(insights.views, 0) AS impressions,
    COALESCE(insights.reach, 0) AS reach,
    COALESCE(
      insights.total_interactions,
      COALESCE(insights.replies, 0) + COALESCE(insights.shares, 0)
    ) AS engagements,
    0 AS saves,
    0 AS clicks,
    COALESCE(insights.views, 0) AS video_views,
    0 AS ad_spend_cents,
    0 AS orders,
    0 AS revenue_cents
  FROM `dopa-content-hub-507613.dopa_airbyte.instagram_story_insights` AS insights
  JOIN `dopa-content-hub-507613.dopa_airbyte.instagram_stories` AS story USING (id)
  WHERE story.timestamp IS NOT NULL
),

facebook_post_metrics AS (
  SELECT
    post_id,
    MAX(IF(name = 'post_impressions', SAFE_CAST(JSON_VALUE(values, '$[0].value') AS INT64), 0)) AS impressions,
    MAX(IF(name = 'post_impressions_unique', SAFE_CAST(JSON_VALUE(values, '$[0].value') AS INT64), 0)) AS reach,
    MAX(IF(name = 'post_engaged_users', SAFE_CAST(JSON_VALUE(values, '$[0].value') AS INT64), 0)) AS engaged_users,
    MAX(IF(name = 'post_clicks', SAFE_CAST(JSON_VALUE(values, '$[0].value') AS INT64), 0)) AS clicks,
    MAX(IF(name = 'post_video_views', SAFE_CAST(JSON_VALUE(values, '$[0].value') AS INT64), 0)) AS video_views
  FROM `dopa-content-hub-507613.dopa_airbyte.facebook_page_post_insights`
  GROUP BY post_id
),

facebook_organic AS (
  SELECT
    'facebook' AS provider,
    DATE(posts.created_time, 'Europe/Amsterdam') AS metric_date,
    'facebook_feed_organic' AS placement_key,
    posts.id AS external_post_id,
    NULLIF(REGEXP_EXTRACT(posts.message, r'(?i)(?:code|utm_content)[:= ]+([A-Za-z0-9_-]+)'), '') AS tracking_code,
    CAST(NULL AS STRING) AS product_ref,
    COALESCE(metrics.impressions, 0) AS impressions,
    COALESCE(metrics.reach, 0) AS reach,
    COALESCE(
      metrics.engaged_users,
      COALESCE(SAFE_CAST(JSON_VALUE(posts.reactions, '$.summary.total_count') AS INT64), 0)
        + COALESCE(SAFE_CAST(JSON_VALUE(posts.comments, '$.summary.total_count') AS INT64), 0)
        + COALESCE(SAFE_CAST(JSON_VALUE(posts.shares, '$.count') AS INT64), 0)
    ) AS engagements,
    0 AS saves,
    COALESCE(metrics.clicks, 0) AS clicks,
    COALESCE(metrics.video_views, 0) AS video_views,
    0 AS ad_spend_cents,
    0 AS orders,
    0 AS revenue_cents
  FROM `dopa-content-hub-507613.dopa_airbyte.facebook_page_posts` AS posts
  LEFT JOIN facebook_post_metrics AS metrics ON metrics.post_id = posts.id
  WHERE posts.created_time IS NOT NULL
),

pinterest_account AS (
  SELECT
    'pinterest' AS provider,
    date AS metric_date,
    'pinterest_account_organic' AS placement_key,
    CAST(NULL AS STRING) AS external_post_id,
    CAST(NULL AS STRING) AS tracking_code,
    CAST(NULL AS STRING) AS product_ref,
    COALESCE(SAFE_CAST(JSON_VALUE(metrics, '$.IMPRESSION') AS INT64), 0) AS impressions,
    0 AS reach,
    COALESCE(SAFE_CAST(JSON_VALUE(metrics, '$.ENGAGEMENT') AS INT64), 0) AS engagements,
    COALESCE(SAFE_CAST(JSON_VALUE(metrics, '$.SAVE') AS INT64), 0) AS saves,
    COALESCE(
      SAFE_CAST(JSON_VALUE(metrics, '$.OUTBOUND_CLICK') AS INT64),
      SAFE_CAST(JSON_VALUE(metrics, '$.PIN_CLICK') AS INT64),
      0
    ) AS clicks,
    COALESCE(SAFE_CAST(JSON_VALUE(metrics, '$.VIDEO_START') AS INT64), 0) AS video_views,
    0 AS ad_spend_cents,
    0 AS orders,
    0 AS revenue_cents
  FROM `dopa-content-hub-507613.dopa_airbyte.pinterest_user_account_analytics`
  WHERE date IS NOT NULL
),

shopify_orders AS (
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
    AND COALESCE(test, FALSE) = FALSE
)

SELECT * FROM meta_paid
UNION ALL SELECT * FROM instagram_organic
UNION ALL SELECT * FROM instagram_stories
UNION ALL SELECT * FROM facebook_organic
UNION ALL SELECT * FROM pinterest_account
UNION ALL SELECT * FROM shopify_orders;
