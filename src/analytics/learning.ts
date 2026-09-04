export interface PerformanceInput {
  planned_post_id: string;
  provider: string;
  placement_key: string;
  content_label: string;
  product_ref?: string | null;
  impressions: number;
  engagements: number;
  saves: number;
  clicks: number;
  orders: number;
  revenue_cents: number;
  ad_spend_cents: number;
}

export interface ResearchSignal {
  signal_id: string;
  topic: string;
  evidence: string;
  source_url: string;
  observed_at: string;
  relevance: number;
}

export interface LearningSnapshot {
  generated_at: string;
  performance_window_days: number;
  totals: { impressions: number; engagements: number; saves: number; clicks: number; orders: number; revenue_cents: number; ad_spend_cents: number; roas: number | null };
  winners: Array<PerformanceInput & { engagement_rate: number; click_rate: number; conversion_rate: number }>;
  relevant_signals: ResearchSignal[];
  strategy_instruction: string;
}

/** Deterministic evidence pack for Claude. It proposes nothing and publishes nothing by itself. */
export function buildLearningSnapshot(performance: readonly PerformanceInput[], signals: readonly ResearchSignal[], generatedAt = new Date().toISOString()): LearningSnapshot {
  const clean = performance.map(validatePerformance);
  const totals = clean.reduce((sum, row) => ({
    impressions: sum.impressions + row.impressions,
    engagements: sum.engagements + row.engagements,
    saves: sum.saves + row.saves,
    clicks: sum.clicks + row.clicks,
    orders: sum.orders + row.orders,
    revenue_cents: sum.revenue_cents + row.revenue_cents,
    ad_spend_cents: sum.ad_spend_cents + row.ad_spend_cents
  }), { impressions: 0, engagements: 0, saves: 0, clicks: 0, orders: 0, revenue_cents: 0, ad_spend_cents: 0 });
  const winners = clean.map((row) => ({ ...row, engagement_rate: rate(row.engagements, row.impressions), click_rate: rate(row.clicks, row.impressions), conversion_rate: rate(row.orders, row.clicks) }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents || b.orders - a.orders || b.saves - a.saves || b.clicks - a.clicks)
    .slice(0, 20);
  const relevantSignals = signals.map(validateSignal).sort((a, b) => b.relevance - a.relevance || b.observed_at.localeCompare(a.observed_at)).slice(0, 30);
  return {
    generated_at: generatedAt,
    performance_window_days: 30,
    totals: { ...totals, roas: totals.ad_spend_cents > 0 ? round(totals.revenue_cents / totals.ad_spend_cents) : null },
    winners,
    relevant_signals: relevantSignals,
    strategy_instruction: "Claude: combineer alleen de aantoonbare prestatiepatronen met de relevante onderzoekssignalen. Benoem bewijs, onzekerheid en kanaal. Maak nieuwe product- en contentvoorstellen als concept; plan of publiceer niets zonder menselijke goedkeuring."
  };
}

function validatePerformance(row: PerformanceInput): PerformanceInput {
  if (!row.planned_post_id || !row.provider || !row.placement_key || !row.content_label) throw new Error("Performance row misses its content identity");
  for (const key of ["impressions", "engagements", "saves", "clicks", "orders", "revenue_cents", "ad_spend_cents"] as const) {
    if (!Number.isFinite(row[key]) || row[key] < 0) throw new Error(`Performance ${key} must be non-negative`);
  }
  return { ...row };
}

function validateSignal(signal: ResearchSignal): ResearchSignal {
  if (!signal.signal_id || !signal.topic.trim() || !signal.evidence.trim()) throw new Error("Research signal is incomplete");
  const url = new URL(signal.source_url);
  if (url.protocol !== "https:") throw new Error("Research signal source must use HTTPS");
  if (!Number.isFinite(Date.parse(signal.observed_at))) throw new Error("Research signal observed_at is invalid");
  if (!Number.isFinite(signal.relevance) || signal.relevance < 0 || signal.relevance > 1) throw new Error("Research signal relevance must be between 0 and 1");
  return { ...signal };
}

function rate(part: number, total: number): number { return total > 0 ? round(part / total) : 0; }
function round(value: number): number { return Math.round(value * 10000) / 10000; }
