export interface RenderJobRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  revision_id: string;
  source_bucket: string;
  source_path: string;
  source_file_name: string;
  instruction: string | null;
  status: string;
}

type FetchLike = typeof fetch;

export class SupabaseRenderStore {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly fetcher: FetchLike = fetch
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      ...extra
    };
  }

  private restUrl(table: string, query = ""): string {
    return `${this.baseUrl.replace(/\/$/, "")}/rest/v1/${table}${query ? `?${query}` : ""}`;
  }

  async claimNext(): Promise<RenderJobRow | null> {
    const claim = await this.fetcher(this.restUrl("rpc/claim_render_job"), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: "{}"
    });
    if (!claim.ok) throw new Error(`Render job claim failed: ${claim.status} ${await claim.text()}`);
    const claimed = await claim.json() as RenderJobRow[];
    return claimed[0] ?? null;
  }

  async updateJob(id: string, values: Record<string, unknown>): Promise<void> {
    await this.patch("render_jobs", `id=eq.${encodeURIComponent(id)}`, { ...values, updated_at: new Date().toISOString() });
  }

  async updateRevision(id: string, values: Record<string, unknown>): Promise<void> {
    await this.patch("campaign_revisions", `id=eq.${encodeURIComponent(id)}`, { ...values, updated_at: new Date().toISOString() });
  }

  async updateCampaign(id: string, values: Record<string, unknown>): Promise<void> {
    await this.patch("campaigns", `id=eq.${encodeURIComponent(id)}`, { ...values, updated_at: new Date().toISOString() });
  }

  private async patch(table: string, filter: string, values: Record<string, unknown>): Promise<void> {
    const response = await this.fetcher(this.restUrl(table, filter), {
      method: "PATCH",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(values)
    });
    if (!response.ok) throw new Error(`${table} update failed: ${response.status} ${await response.text()}`);
  }

  async insert<T>(table: string, values: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(this.restUrl(table), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", prefer: "return=representation" }),
      body: JSON.stringify(values)
    });
    if (!response.ok) throw new Error(`${table} insert failed: ${response.status} ${await response.text()}`);
    const rows = await response.json() as T[];
    if (!rows[0]) throw new Error(`${table} insert returned no row`);
    return rows[0];
  }

  private objectUrl(bucket: string, objectPath: string, authenticated: boolean): string {
    const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
    const prefix = authenticated ? "object/authenticated" : "object";
    return `${this.baseUrl.replace(/\/$/, "")}/storage/v1/${prefix}/${encodeURIComponent(bucket)}/${encoded}`;
  }

  async download(bucket: string, objectPath: string): Promise<Buffer> {
    const response = await this.fetcher(this.objectUrl(bucket, objectPath, true), { headers: this.headers() });
    if (!response.ok) throw new Error(`Source download failed: ${response.status} ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async upload(bucket: string, objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.fetcher(this.objectUrl(bucket, objectPath, false), {
      method: "POST",
      headers: this.headers({ "content-type": contentType, "x-upsert": "false" }),
      body: new Uint8Array(bytes)
    });
    if (!response.ok) throw new Error(`Output upload failed: ${response.status} ${await response.text()}`);
  }
}
