# Dopa live readiness

Verified on 2026-09-12 against the Dopa Airbyte workspace and BigQuery project.

## Working now

- Shopify to BigQuery: `bce72712-f24e-4f0c-a294-1675e13c2c5d`
- Meta Ads to BigQuery: `48100480-4084-44cc-a01a-ba50e54d04c1`
- Instagram organic to BigQuery: `01928891-2508-4049-ae15-bcf755834153`
- Pinterest to BigQuery: `1074aac1-6530-4ce1-94bf-5c4c557848a4`
- Facebook organic to BigQuery: `8515892f-1372-4d1b-9b29-4b524c61a6f7`
  - The first sync on 2026-09-12 loaded 17 Page posts.
  - The post-insights stream completed successfully but returned zero metric rows;
    content-level reach, click and engagement metrics still need a Graph API v25
    query that returns data for Dopa's posts.
- Google Analytics 4 to BigQuery: `04efd5ed-1cb2-443c-b0a2-9d677a7eda9d`
  - Dopa account: `407648609`
  - Dopa webshop property: `553701814`
  - Measurement ID: `G-66V2CK347E`
  - The Airbyte service account has GA4 Viewer access and the first sync was
    started on 2026-09-12.
  - GA4 currently reports that it has not received website data. Install the
    measurement tag on the production storefront before treating this source
    as end-to-end conversion proof.
- BigQuery destination: `563166ae-9065-4a72-9e5a-80f49b053eed`
- Normalized model: `dopa-content-hub-507613.dopa_airbyte.content_performance_daily`
- The renderer produces static platform variants and real animated MP4 variants.
- The conversation connector can read the learning snapshot, remember user context,
  store dated research evidence, plan channels and queue only an approved revision.

## Account work still required

- Google Analytics 4: install `G-66V2CK347E` on the production storefront and
  verify that a real visit reaches both GA4 and BigQuery.
- Google Search Console: verify `sc-domain:dopadispatch.shop` for
  `dopaminedispatch@gmail.com`; OAuth itself has already succeeded.
- Facebook organic metrics: the Page post feed is live, but the post-insights
  stream currently returns zero records. Do not treat reach, clicks or reactions
  as verified until at least one real metric row is visible in BigQuery.
- Etsy: authorize the Dopa Etsy shop before enabling publication or ingestion.

Google Business Profile is intentionally excluded while Dopa is a fully online
business without in-person customer contact.

## Definition of done

A provider is only marked live after one real account sync or publication has a
provider receipt and its resulting row is visible in the normalized model. A
healthy connector with no returned rows is not counted as proof of end-to-end data.
