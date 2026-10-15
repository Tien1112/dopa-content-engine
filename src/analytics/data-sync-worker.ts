import { configuredConnections, runAirbyteWorker, type AirbyteConnectionRoute, type AirbyteRouteProgress } from "./airbyte-worker.js";
import { runDirectEtsySync, type DirectEtsyDependencies } from "./etsy-direct.js";
import { runDirectFacebookOrganicSync, type DirectFacebookDependencies } from "./facebook-organic-direct.js";

export type DataSyncWorkerOptions = {
  connections: readonly AirbyteConnectionRoute[];
  onProgress?: (progress: AirbyteRouteProgress) => void;
  directFacebookDependencies?: DirectFacebookDependencies;
  directEtsyDependencies?: DirectEtsyDependencies;
};

/** Transitional orchestrator: direct providers bypass Airbyte while remaining routes keep their existing path. */
export async function runDataSyncWorker(options: DataSyncWorkerOptions): Promise<void> {
  const directFacebook = options.connections.filter(isDirectFacebookRoute);
  const directEtsy = options.connections.filter(isDirectEtsyRoute);
  const airbyte = options.connections.filter((route) => !isDirectFacebookRoute(route) && !isDirectEtsyRoute(route));
  for (const route of directFacebook) {
    await runDirectFacebookOrganicSync(route, options.onProgress, options.directFacebookDependencies);
  }
  for (const route of directEtsy) {
    await runDirectEtsySync(route, options.onProgress, options.directEtsyDependencies);
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

export function configuredDataSyncConnections(): AirbyteConnectionRoute[] {
  const routes = configuredConnections();
  if (process.env.DOPA_ETSY_CONFIG_JSON && !routes.some(isDirectEtsyRoute)) {
    routes.push({ name: "etsy", connectionId: "direct-etsy", imports: [{ provider: "etsy", scope: "all" }] });
  }
  return routes;
}

export function isDirectFacebookRoute(route: AirbyteConnectionRoute): boolean {
  return sourceKey(route.name) === "facebook_organic"
    && route.imports.length === 1
    && route.imports[0]?.provider === "facebook"
    && route.imports[0]?.scope === "organic";
}

export function isDirectEtsyRoute(route: AirbyteConnectionRoute): boolean {
  return sourceKey(route.name) === "etsy"
    && route.imports.length === 1
    && route.imports[0]?.provider === "etsy";
}

function sourceKey(name: string): string {
  return name.trim().toLowerCase().replace(/^dopa[\s_-]+/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
