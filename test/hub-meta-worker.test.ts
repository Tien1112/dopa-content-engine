import assert from "node:assert/strict";
import test from "node:test";
import { PublishGatewayStore, type HubMetaPublishJob } from "../src/publishing/hub-gateway.js";
import { processHubMetaJob, toContentPlanItem } from "../src/publishing/hub-meta-worker.js";

const token = "p".repeat(48);

function job(overrides: Partial<HubMetaPublishJob> = {}): HubMetaPublishJob {
  return {
    job_id: "8ee1eb44-ded4-4c2a-97c7-b0bf1ea08857",
    planned_post_id: "4cf0568f-f147-4bfa-aa2d-f169829f72b7",
    workspace_id: "workspace",
    campaign_id: "campaign",
    revision_id: "revision",
    provider: "instagram",
    placement_key: "instagram_feed",
    publish_at: "2030-08-21T10:00:00",
    timezone: "Europe/Amsterdam",
    copy_text: "Caption",
    hashtags: ["dopa"],
    alt_text: "Beschrijving",
    destination_url: "https://dopa.example/product?utm_source=instagram",
    tracking_code: "dopa-123",
    attempt_count: 1,
    contract_version: 1,
    asset: {
      asset_file_id: "asset-file",
      asset_id: "asset",
      file_name: "design.png",
      format_key: "instagram_feed",
      mime_type: "image/png",
      width: 1080,
      height: 1350,
      qa_status: "passed",
      download_url: "https://storage.example/signed-design.png",
      download_expires_in: 1800
    },
    ...overrides
  };
}

test("publish gateway authenticates, claims and records the Meta receipt", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fakeFetch = async (_input: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push(body);
    if (body.action === "health") return Response.json({ ok: true, version: 1 });
    if (body.action === "claim_meta") return Response.json({ job: job() });
    return Response.json({ ok: true });
  };
  const store = new PublishGatewayStore("https://dopa.example/api/public/publish-worker", token, fakeFetch as typeof fetch);
  await store.health();
  const claimed = await store.claimMeta();
  assert.equal(claimed?.placement_key, "instagram_feed");
  await store.complete(claimed!.job_id, { platform_id: "ig-post-1", container_ids: ["container-1"] });
  assert.deepEqual(requests[2], {
    action: "complete",
    job_id: job().job_id,
    external_post_id: "ig-post-1",
    receipt: { platform_id: "ig-post-1", container_ids: ["container-1"] }
  });
});

test("Hub job maps only proven Meta placements and keeps the signed asset", () => {
  const item = toContentPlanItem(job(), { instagram: "dopa-instagram", facebook: "dopa-facebook" });
  assert.equal(item.channel, "instagram");
  assert.equal(item.content_type, "feed_post");
  assert.equal(item.account_ref, "dopa-instagram");
  assert.equal(item.media[0]?.public_url, "https://storage.example/signed-design.png");
  assert.match(item.copy.destination_url ?? "", /dopa_content=dopa-123/);

  const reel = toContentPlanItem(job({ placement_key: "instagram_reel", asset: { ...job().asset, mime_type: "video/mp4", height: 1920 } }), { instagram: "dopa-instagram", facebook: "dopa-facebook" });
  assert.equal(reel.content_type, "reel");
});

test("worker completes success and reports a bounded failure", async () => {
  const completed: string[] = [];
  const failed: string[] = [];
  const store = {
    complete: async (jobId: string) => { completed.push(jobId); },
    fail: async (jobId: string, message: string) => { failed.push(`${jobId}:${message}`); }
  };
  await processHubMetaJob(store, { publish: async () => ({ platform_id: "post-1" }) }, job(), { instagram: "dopa-instagram", facebook: "dopa-facebook" });
  assert.deepEqual(completed, [job().job_id]);
  await processHubMetaJob(store, { publish: async () => { throw new Error("Meta refused media"); } }, job(), { instagram: "dopa-instagram", facebook: "dopa-facebook" });
  assert.match(failed[0] ?? "", /Meta refused media/);
});

test("publish gateway rejects weak tokens and unsupported contracts", async () => {
  assert.throws(() => new PublishGatewayStore("https://dopa.example/worker", "short"), /at least 32/);
  const fakeFetch = async () => Response.json({ job: job({ contract_version: 2 as 1 }) });
  const store = new PublishGatewayStore("https://dopa.example/worker", token, fakeFetch as typeof fetch);
  await assert.rejects(store.claimMeta(), /contract version/);
});
