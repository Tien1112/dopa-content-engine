import { createSign } from "node:crypto";
import type { DataProvider, PerformanceRecord } from "./hub-data-gateway.js";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type BigQueryField = { name: string };
type BigQueryCell = { v: unknown };
type BigQueryResponse = {
  schema?: { fields?: BigQueryField[] };
  rows?: Array<{ f?: BigQueryCell[] }>;
  pageToken?: string;
  jobReference?: { jobId?: string; location?: string };
  jobComplete?: boolean;
  errors?: Array<{ message?: string }>;
};

const IDENTIFIER = /^[A-Za-z0-9_.-]+$/;
const INTEGER_FIELDS = new Set([
  "impressions", "reach", "engagements", "saves", "clicks", "video_views",
  "ad_spend_cents", "orders", "revenue_cents",
]);

/** Reads the normalized Airbyte destination view; it never talks to a source platform directly. */
export class BigQueryPerformanceReader {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly projectId: string,
    private readonly datasetId: string,
    private readonly tableId: string,
    private readonly serviceAccount: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    for (const [label, value] of [["project", projectId], ["dataset", datasetId], ["table", tableId]] as const) {
      if (!IDENTIFIER.test(value)) throw new Error(`Invalid BigQuery ${label} identifier`);
    }
    if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error("BigQuery service account is incomplete");
  }

  static fromEnvironment(fetchImpl: typeof fetch = fetch): BigQueryPerformanceReader | null {
    const raw = process.env.DOPA_BIGQUERY_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    let account: ServiceAccount;
    try { account = JSON.parse(raw) as ServiceAccount; } catch { throw new Error("DOPA_BIGQUERY_SERVICE_ACCOUNT_JSON must contain valid JSON"); }
    return new BigQueryPerformanceReader(
      required("DOPA_BIGQUERY_PROJECT_ID"),
      required("DOPA_BIGQUERY_DATASET"),
      process.env.DOPA_BIGQUERY_PERFORMANCE_TABLE ?? "content_performance_daily",
      account,
      fetchImpl,
    );
  }

  async read(provider: DataProvider, days = 35): Promise<PerformanceRecord[]> {
    const sql = `SELECT metric_date, placement_key, external_post_id, tracking_code, product_ref,
      impressions, reach, engagements, saves, clicks, video_views, ad_spend_cents, orders, revenue_cents
      FROM \`${this.projectId}.${this.datasetId}.${this.tableId}\`
      WHERE provider = @provider
        AND metric_date >= DATE_SUB(CURRENT_DATE("Europe/Amsterdam"), INTERVAL @days DAY)
      ORDER BY metric_date ASC`;
    const first = await this.request<BigQueryResponse>(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/queries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        parameterMode: "NAMED",
        queryParameters: [
          { name: "provider", parameterType: { type: "STRING" }, parameterValue: { value: provider } },
          { name: "days", parameterType: { type: "INT64" }, parameterValue: { value: String(days) } },
        ],
        maxResults: 10_000,
        timeoutMs: 30_000,
      }),
    });
    if (first.jobComplete === false) throw new Error("BigQuery normalization query did not finish within 30 seconds");
    return decodeRows(first);
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const token = await this.accessToken();
    const response = await this.fetchImpl(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
      redirect: "error",
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`BigQuery request failed (${response.status})`);
    try { return JSON.parse(raw) as T; } catch { throw new Error("BigQuery returned invalid JSON"); }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt(this.serviceAccount, now);
    const tokenUrl = this.serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
    const response = await this.fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      redirect: "error",
    });
    const value = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
    if (!response.ok || !value.access_token) throw new Error(`BigQuery authentication failed (${response.status})`);
    this.token = { value: value.access_token, expiresAt: Date.now() + Math.max(60, value.expires_in ?? 3600) * 1000 };
    return value.access_token;
  }
}

function signJwt(account: ServiceAccount, now: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: account.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(account.private_key).toString("base64url");
  return `${unsigned}.${signature}`;
}

function decodeRows(response: BigQueryResponse): PerformanceRecord[] {
  if (response.errors?.length) throw new Error(`BigQuery query failed: ${response.errors[0]?.message ?? "unknown error"}`);
  const fields = response.schema?.fields?.map((field) => field.name) ?? [];
  return (response.rows ?? []).map((row) => {
    const raw = Object.fromEntries(fields.map((name, index) => [name, row.f?.[index]?.v ?? null]));
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === "") continue;
      record[key] = INTEGER_FIELDS.has(key) ? safeInteger(value, key) : String(value);
    }
    if (!record.metric_date) throw new Error("BigQuery performance row misses metric_date");
    return record as unknown as PerformanceRecord;
  });
}

function safeInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`BigQuery ${field} is not a non-negative safe integer`);
  return parsed;
}

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
