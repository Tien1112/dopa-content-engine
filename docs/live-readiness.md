# Dopa live readiness

Verified on 2026-09-11 against the Dopa Airbyte workspace and BigQuery project.

## Working now

- Shopify to BigQuery: `bce72712-f24e-4f0c-a294-1675e13c2c5d`
- Meta Ads to BigQuery: `48100480-4084-44cc-a01a-ba50e54d04c1`
- Instagram organic to BigQuery: `01928891-2508-4049-ae15-bcf755834153`
- Pinterest to BigQuery: `1074aac1-6530-4ce1-94bf-5c4c557848a4`
- BigQuery destination: `563166ae-9065-4a72-9e5a-80f49b053eed`
- Normalized model: `dopa-content-hub-507613.dopa_airbyte.content_performance_daily`
- The renderer produces static platform variants and real animated MP4 variants.
- The conversation connector can read the learning snapshot, remember user context,
  store dated research evidence, plan channels and queue only an approved revision.

## Account work still required

- Google Analytics 4: supply or create the Dopa GA4 numeric Property ID.
- Google Search Console: verify `sc-domain:dopadispatch.shop` for
  `dopaminedispatch@gmail.com`; OAuth itself has already succeeded.
- Facebook organic: the Connector Builder manifest and BigQuery normalization
  are ready in the repository. Import the manifest, supply the existing Page
  token in Airbyte, connect both streams to BigQuery and verify the first rows
  before declaring this feed live.
- Etsy: authorize the Dopa Etsy shop before enabling publication or ingestion.

Google Business Profile is intentionally excluded while Dopa is a fully online
business without in-person customer contact.

## Definition of done

A provider is only marked live after one real account sync or publication has a
provider receipt and its resulting row is visible in the normalized model. A
healthy connector with no returned rows is not counted as proof of end-to-end data.
