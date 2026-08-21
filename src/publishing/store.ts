import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { approveContentPlan, assertValidContentPlan } from "./plan.js";
import type { ContentPlan } from "./types.js";

export interface PlanSummary {
  plan_id: string;
  revision: number;
  brand: string;
  timezone: string;
  status: ContentPlan["status"];
  items: number;
}

export class ContentPlanStore {
  constructor(readonly root: string) {}

  async createDraft(plan: ContentPlan): Promise<ContentPlan> {
    assertPlanId(plan.plan_id);
    assertValidContentPlan(plan);
    if (plan.status !== "draft" || plan.approval) throw new Error("A new content plan must be an unapproved draft");
    if (plan.revision !== 1) throw new Error("A new content plan must start at revision 1");
    if (await this.exists(plan.plan_id)) throw new Error(`Content plan already exists: ${plan.plan_id}`);
    await this.write(plan);
    return plan;
  }

  async replaceDraft(plan: ContentPlan): Promise<ContentPlan> {
    assertPlanId(plan.plan_id);
    const current = await this.get(plan.plan_id);
    if (current.status !== "draft") throw new Error(`Approved content plan ${plan.plan_id} cannot be edited; create a new plan`);
    if (plan.status !== "draft" || plan.approval) throw new Error("A replacement must be an unapproved draft");
    if (plan.revision !== current.revision + 1) throw new Error(`Replacement revision must be ${current.revision + 1}`);
    assertValidContentPlan(plan);
    await this.write(plan);
    return plan;
  }

  async approve(planId: string, expectedRevision: number, approvedBy: string, approvedAt: string): Promise<ContentPlan> {
    const current = await this.get(planId);
    if (current.revision !== expectedRevision) throw new Error(`Plan revision changed: expected ${expectedRevision}, current revision is ${current.revision}`);
    const approved = approveContentPlan(current, { approved_by: approvedBy, approved_at: approvedAt });
    await this.write(approved);
    return approved;
  }

  async get(planId: string): Promise<ContentPlan> {
    assertPlanId(planId);
    try {
      return JSON.parse(await readFile(path.join(this.planRoot(planId), "latest.json"), "utf8")) as ContentPlan;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Unknown content plan: ${planId}`);
      throw error;
    }
  }

  async list(): Promise<PlanSummary[]> {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const plans = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try { return await this.get(entry.name); } catch { return undefined; }
    }));
    return plans.filter((plan): plan is ContentPlan => Boolean(plan)).map((plan) => ({
      plan_id: plan.plan_id,
      revision: plan.revision,
      brand: plan.brand,
      timezone: plan.timezone,
      status: plan.status,
      items: plan.items.length
    })).sort((left, right) => left.plan_id.localeCompare(right.plan_id));
  }

  private async exists(planId: string): Promise<boolean> {
    try { await this.get(planId); return true; } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unknown content plan:")) return false;
      throw error;
    }
  }

  private async write(plan: ContentPlan): Promise<void> {
    const root = this.planRoot(plan.plan_id);
    await mkdir(root, { recursive: true });
    const body = `${JSON.stringify(plan, null, 2)}\n`;
    await atomicWrite(path.join(root, `revision-${plan.revision}.json`), body);
    await atomicWrite(path.join(root, "latest.json"), body);
  }

  private planRoot(planId: string): string {
    assertPlanId(planId);
    return path.join(this.root, planId);
  }
}

async function atomicWrite(file: string, body: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function assertPlanId(planId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(planId)) throw new Error("plan_id must be a lowercase slug (letters, numbers and hyphens)");
}
