import { runAirbyteWorker, type AirbyteConnectionRoute, type AirbyteRouteProgress } from "./airbyte-worker.js";
import { runDirectFacebookOrganicSync, type DirectFacebookDependencies } from "./facebook-organic-direct.js";

export type DataSyncWorkerOptions = {
  connections: readonly AirbyteConnectionRoute[];
  onProgress?: (progress: AirbyteRouteProgress) => void;
  directFacebookDependencies?: DirectFacebookDependencies;
};

/** Transitional orchestrator: direct providers bypass Airbyte while remaining routes keep their existing path. */
export async function runDataSyncWorker(options: DataSyncWorkerOptions): Promise<void> {
  const directFacebook = options.connections.filter(isDirectFacebookRoute);
  const airbyte = options.connections.filter((route) => !isDirectFacebookRoute(route));
  for (const route of directFacebook) {
    await runDirectFacebookOrganicSync(route, options.onProgress, options.directFacebookDependencies);
  }
  if (airbyte.length) {
    await runAirbyteWorker({
      once: true,
      importOnly: false,
      connections: airbyte,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
  }
}

export function isDirectFacebookRoute(route: AirbyteConnectionRoute): boolean {
  return sourceKey(route.name) === "facebook_organic"
    && route.imports.length === 1
    && route.imports[0]?.provider === "facebook"
    && route.imports[0]?.scope === "organic";
}

function sourceKey(name: string): string {
  return name.trim().toLowerCase().replace(/^dopa[\s_-]+/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
