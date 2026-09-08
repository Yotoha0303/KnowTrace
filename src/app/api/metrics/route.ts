import { databaseIsReady } from "@/server/health";
import { getMetricsState, metricsRequestIsAuthorized } from "@/server/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!metricsRequestIsAuthorized(request.headers.get("authorization"))) {
    return new Response("Not Found\n", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const metrics = getMetricsState();
  const startedAt = process.hrtime.bigint();
  const ready = await databaseIsReady();
  const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

  metrics.databaseReady.set(ready ? 1 : 0);
  metrics.databaseProbeDuration.set(elapsedSeconds);
  metrics.metricsScrapes.inc({ database: ready ? "ready" : "unready" });

  return new Response(await metrics.registry.metrics(), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": metrics.registry.contentType,
    },
  });
}
