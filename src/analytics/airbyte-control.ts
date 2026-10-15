import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { configuredConnections, runAirbyteWorker, type AirbyteRouteProgress } from "./airbyte-worker.js";

const CONFIRMATION = "SYNC NU ALLE DOPA DATA";
type ControlRun = {
  runId: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  routes: AirbyteRouteProgress[];
};

export function listenAirbyteControl(port = Number(process.env.AIRBYTE_CONTROL_PORT ?? process.env.PORT ?? 8080)) {
  const token = required("DOPA_AIRBYTE_CONTROL_TOKEN");
  if (token.length < 32) throw new Error("DOPA_AIRBYTE_CONTROL_TOKEN must contain at least 32 characters");
  let current: ControlRun | null = null;
  const history = new Map<string, ControlRun>();

  const server = createServer(async (request, response) => {
    if (request.url === "/health" && request.method === "GET") return send(response, 200, { ok: true, service: "dopa-airbyte-control" });
    if (!authorized(request, token)) return send(response, 404, { error: "Not found" });

    if (request.url === "/sync" && request.method === "POST") {
      const body = await readJson(request).catch(() => null) as { confirmation?: unknown } | null;
      if (body?.confirmation !== CONFIRMATION) return send(response, 400, { error: `Confirmation must equal: ${CONFIRMATION}` });
      if (current?.status === "running") return send(response, 409, { error: "A Dopa data sync is already running", run: publicRun(current) });

      const run: ControlRun = {
        runId: randomUUID(),
        status: "running",
        startedAt: new Date().toISOString(),
        routes: configuredConnections().map((route) => ({ name: route.name, status: "pending" })),
      };
      current = run;
      history.set(run.runId, run);
      void runAirbyteWorker({
        once: true,
        importOnly: false,
        onProgress: (progress) => {
          const index = run.routes.findIndex((route) => route.name === progress.name);
          if (index >= 0) run.routes[index] = progress;
        },
      }).then(() => {
        run.status = run.routes.every((route) => route.status === "succeeded") ? "succeeded" : "failed";
        run.finishedAt = new Date().toISOString();
      }).catch((error) => {
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        const message = safe(error instanceof Error ? error.message : String(error));
        for (const route of run.routes) if (route.status === "pending" || route.status === "running") route.status = "failed", route.error = message;
      });
      return send(response, 202, { run: publicRun(run) });
    }

    const match = request.method === "GET" ? request.url?.match(/^\/sync\/([0-9a-f-]{36})$/i) : null;
    if (match) {
      const run = history.get(match[1]!);
      return run ? send(response, 200, { run: publicRun(run) }) : send(response, 404, { error: "Sync run not found" });
    }
    return send(response, 404, { error: "Not found" });
  });
  return server.listen(port, "0.0.0.0", () => process.stdout.write(`Dopa Airbyte control listening on ${port}\n`));
}

function publicRun(run: ControlRun) {
  return {
    run_id: run.runId,
    status: run.status,
    started_at: run.startedAt,
    ...(run.finishedAt ? { finished_at: run.finishedAt } : {}),
    routes: run.routes.map((route) => ({
      name: route.name,
      status: route.status,
      ...(route.jobId === undefined ? {} : { job_id: route.jobId }),
      ...(route.rowsLoaded === undefined ? {} : { rows_loaded: route.rowsLoaded }),
      ...(route.error ? { error: safe(route.error) } : {}),
    })),
  };
}

function authorized(request: IncomingMessage, token: string): boolean {
  const raw = request.headers.authorization ?? "";
  const provided = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 16_384) throw new Error("Request too large");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function safe(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300); }
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
