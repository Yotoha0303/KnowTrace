import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Registry,
} from "prom-client";

type MetricsState = {
  registry: Registry;
  databaseReady: Gauge;
  databaseProbeDuration: Gauge;
  metricsScrapes: Counter;
  requestErrors: Counter;
};

const globalMetrics = globalThis as typeof globalThis & {
  __knowtraceMetrics?: MetricsState;
};

function createMetricsState(): MetricsState {
  const registry = new Registry();
  collectDefaultMetrics({ prefix: "knowtrace_", register: registry });

  const buildInfo = new Gauge({
    name: "knowtrace_build_info",
    help: "KnowTrace build information.",
    labelNames: ["version", "revision", "environment"] as const,
    registers: [registry],
  });
  buildInfo.set(
    {
      version: process.env.npm_package_version ?? "0.1.0",
      revision: process.env.KNOWTRACE_APP_REVISION ?? "unknown",
      environment: process.env.NODE_ENV ?? "unknown",
    },
    1,
  );

  return {
    registry,
    databaseReady: new Gauge({
      name: "knowtrace_database_ready",
      help: "Whether the KnowTrace PostgreSQL dependency is ready (1) or unavailable (0).",
      registers: [registry],
    }),
    databaseProbeDuration: new Gauge({
      name: "knowtrace_database_probe_duration_seconds",
      help: "Duration of the latest PostgreSQL readiness probe in seconds.",
      registers: [registry],
    }),
    metricsScrapes: new Counter({
      name: "knowtrace_metrics_scrapes_total",
      help: "Number of authorized Prometheus scrapes by database readiness result.",
      labelNames: ["database"] as const,
      registers: [registry],
    }),
    requestErrors: new Counter({
      name: "knowtrace_request_errors_total",
      help: "Server request errors captured by Next.js instrumentation.",
      labelNames: ["route_type", "route_path"] as const,
      registers: [registry],
    }),
  };
}

export function getMetricsState(): MetricsState {
  globalMetrics.__knowtraceMetrics ??= createMetricsState();
  return globalMetrics.__knowtraceMetrics;
}

export function registerMetricsRuntime(): void {
  getMetricsState();
}

export function recordRequestError(routeType: string, routePath: string): void {
  getMetricsState().requestErrors.inc({
    route_type: routeType || "unknown",
    route_path: routePath || "unknown",
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function metricsRequestIsAuthorized(authorization: string | null): boolean {
  const expected = process.env.METRICS_BEARER_TOKEN?.trim();
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const provided = authorization.slice("Bearer ".length);
  return constantTimeEqual(provided, expected);
}
