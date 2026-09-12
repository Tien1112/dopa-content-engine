import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const model = readFileSync(resolve("config/bigquery/content-performance.sql"), "utf8");

test("canonical performance model includes GA4 campaign and purchase data", () => {
  assert.match(model, /traffic_acquisition_session_campaign_report/);
  assert.match(model, /events_report/);
  assert.match(model, /LOWER\(eventName\) IN \('purchase', 'in_app_purchase'\)/);
  assert.match(model, /COALESCE\(eventCount, 0\) AS orders/);
  assert.match(model, /UNION ALL SELECT \* FROM google_analytics_campaign/);
  assert.match(model, /UNION ALL SELECT \* FROM google_analytics_purchases/);
});

test("GA4 sessions are not mislabeled as social clicks or impressions", () => {
  const campaign = model.match(/google_analytics_campaign AS \([\s\S]*?\n\),/)?.[0] ?? "";
  assert.match(campaign, /COALESCE\(engagedSessions, 0\) AS engagements/);
  assert.match(campaign, /0 AS impressions/);
  assert.match(campaign, /0 AS clicks/);
  assert.doesNotMatch(campaign, /sessions\s+AS\s+clicks/i);
});
