export type AirbyteJobStatus = "pending" | "running" | "incomplete" | "failed" | "succeeded" | "cancelled";

export interface AirbyteConfig {
  client_id_env: string;
  client_secret_env: string;
  api_base_url?: string;
}

export interface AirbyteJob {
  jobId: number;
  status: AirbyteJobStatus;
  connectionId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Minimal Airbyte Cloud control-plane client. Raw source credentials stay in Airbyte. */
export class AirbyteClient {
  private readonly base: string;
  constructor(private readonly config: AirbyteConfig, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = (config.api_base_url ?? "https://api.airbyte.com").replace(/\/$/, "");
  }

  async triggerSync(connectionId: string): Promise<AirbyteJob> {
    const body = await this.request("/v1/jobs", { method: "POST", body: JSON.stringify({ connectionId: uuid(connectionId), jobType: "sync" }) });
    return job(body);
  }

  async getJob(jobId: number): Promise<AirbyteJob> {
    if (!Number.isSafeInteger(jobId) || jobId < 1) throw new Error("Invalid Airbyte job ID");
    return job(await this.request(`/v1/jobs/${jobId}`));
  }

  async waitForJob(jobId: number, options: { attempts?: number; intervalMs?: number } = {}): Promise<AirbyteJob> {
    const attempts = Math.max(1, Math.min(options.attempts ?? 120, 720));
    const interval = Math.max(1000, options.intervalMs ?? 5000);
    for (let i = 0; i < attempts; i += 1) {
      const current = await this.getJob(jobId);
      if (["succeeded", "failed", "incomplete", "cancelled"].includes(current.status)) return current;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Airbyte job ${jobId} did not finish within the configured polling window`);
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.accessToken();
    const response = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
      redirect: "error"
    });
    return parse(response, `Airbyte ${path}`);
  }

  private async accessToken(): Promise<string> {
    const clientId = process.env[this.config.client_id_env];
    const clientSecret = process.env[this.config.client_secret_env];
    if (!clientId || !clientSecret) throw new Error("Missing Airbyte application credentials");
    const response = await this.fetchImpl(`${this.base}/v1/applications/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, "grant-type": "client_credentials" }),
      redirect: "error"
    });
    const body = await parse(response, "Airbyte token") as { access_token?: string };
    if (!body.access_token) throw new Error("Airbyte token response did not contain access_token");
    return body.access_token;
  }
}

async function parse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error(`${label} response exceeds 1 MB`);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON`); }
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return body;
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid Airbyte connection ID");
  return value;
}

function job(value: unknown): AirbyteJob {
  const v = value as { jobId?: unknown; id?: unknown; status?: unknown; connectionId?: unknown; createdAt?: unknown; updatedAt?: unknown };
  const jobId = Number(v?.jobId ?? v?.id);
  const status = String(v?.status ?? "").toLowerCase() as AirbyteJobStatus;
  if (!Number.isSafeInteger(jobId) || jobId < 1) throw new Error("Airbyte response has no valid job ID");
  if (!["pending", "running", "incomplete", "failed", "succeeded", "cancelled"].includes(status)) throw new Error("Airbyte response has an unknown job status");
  return {
    jobId,
    status,
    ...(typeof v.connectionId === "string" ? { connectionId: v.connectionId } : {}),
    ...(typeof v.createdAt === "string" ? { createdAt: v.createdAt } : {}),
    ...(typeof v.updatedAt === "string" ? { updatedAt: v.updatedAt } : {})
  };
}
