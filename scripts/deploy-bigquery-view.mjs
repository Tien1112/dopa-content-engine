import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const projectId = required("DOPA_BIGQUERY_PROJECT_ID");
const sqlPath = process.argv[2];
if (!sqlPath) throw new Error("Pass the BigQuery SQL file as the first argument");

let account;
try {
  account = JSON.parse(required("DOPA_BIGQUERY_SERVICE_ACCOUNT_JSON"));
} catch {
  throw new Error("DOPA_BIGQUERY_SERVICE_ACCOUNT_JSON must contain valid JSON");
}
if (!account.client_email || !account.private_key) throw new Error("BigQuery service account is incomplete");

const token = await accessToken(account);
let query = await readFile(sqlPath, "utf8");
if (!(await tableExists(token, "dopa_airbyte", "etsy_shop_receipts"))) {
  query = withoutEtsyOrders(query);
  console.warn("Etsy receipt table is not available yet; deploying the view without Etsy rows.");
}
const response = await fetch(
  `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 30_000 }),
    redirect: "error",
  },
);
const value = await response.json().catch(() => ({}));
if (!response.ok || value.errors?.length) {
  const message = value.error?.message ?? value.errors?.[0]?.message ?? `HTTP ${response.status}`;
  throw new Error(`BigQuery deployment failed: ${String(message).slice(0, 500)}`);
}
if (value.jobComplete === false) throw new Error("BigQuery deployment did not finish within 30 seconds");
console.log("BigQuery content performance view deployed successfully.");

async function tableExists(accessToken, datasetId, tableId) {
  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}`,
    { headers: { authorization: `Bearer ${accessToken}` }, redirect: "error" },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`BigQuery table check failed (${response.status})`);
  return true;
}

function withoutEtsyOrders(sql) {
  const fallback = `etsy_orders AS (
  SELECT
    CAST(NULL AS STRING) AS provider,
    CAST(NULL AS DATE) AS metric_date,
    CAST(NULL AS STRING) AS placement_key,
    CAST(NULL AS STRING) AS external_post_id,
    CAST(NULL AS STRING) AS tracking_code,
    CAST(NULL AS STRING) AS product_ref,
    CAST(NULL AS INT64) AS impressions,
    CAST(NULL AS INT64) AS reach,
    CAST(NULL AS INT64) AS engagements,
    CAST(NULL AS INT64) AS saves,
    CAST(NULL AS INT64) AS clicks,
    CAST(NULL AS INT64) AS video_views,
    CAST(NULL AS INT64) AS ad_spend_cents,
    CAST(NULL AS INT64) AS orders,
    CAST(NULL AS INT64) AS revenue_cents
  FROM (SELECT 1)
  WHERE FALSE
)

SELECT * FROM meta_paid`;
  const marker = /etsy_orders AS \([\s\S]*?\n\)\n\nSELECT \* FROM meta_paid/;
  if (!marker.test(sql)) throw new Error("Etsy CTE could not be isolated for the temporary fallback");
  return sql.replace(marker, fallback);
}

async function accessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUrl = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const encode = (input) => Buffer.from(JSON.stringify(input)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/bigquery",
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  })}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).end().sign(serviceAccount.private_key).toString("base64url")}`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    redirect: "error",
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || !value.access_token) throw new Error(`BigQuery authentication failed (${response.status})`);
  return value.access_token;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
