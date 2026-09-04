import assert from "node:assert/strict";
import test from "node:test";
import { buildLearningSnapshot } from "../src/analytics/learning.js";

test("learning snapshot combines measured winners with current research signals", () => {
  const snapshot = buildLearningSnapshot([
    { planned_post_id: "a", provider: "pinterest", placement_key: "pinterest_standard", content_label: "Quote A", impressions: 1000, engagements: 80, saves: 60, clicks: 40, orders: 4, revenue_cents: 10000, ad_spend_cents: 2500 },
    { planned_post_id: "b", provider: "instagram", placement_key: "instagram_feed", content_label: "Quote B", impressions: 2000, engagements: 300, saves: 100, clicks: 20, orders: 1, revenue_cents: 2500, ad_spend_cents: 0 }
  ], [{ signal_id: "s1", topic: "self-care", evidence: "Growing search interest", source_url: "https://example.com/evidence", observed_at: "2026-09-03T10:00:00Z", relevance: 0.9 }], "2026-09-04T10:00:00Z");
  assert.equal(snapshot.totals.revenue_cents, 12500);
  assert.equal(snapshot.totals.roas, 5);
  assert.equal(snapshot.winners[0]!.planned_post_id, "a");
  assert.equal(snapshot.relevant_signals[0]!.topic, "self-care");
  assert.match(snapshot.strategy_instruction, /menselijke goedkeuring/);
});
