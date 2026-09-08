import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/server/health", () => ({
  databaseIsReady: vi.fn(async () => true),
}));

import { GET } from "./route";

describe("GET /api/metrics", () => {
  beforeEach(() => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "test-metrics-token-with-sufficient-length");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not disclose metrics without the internal bearer token", async () => {
    const response = await GET(new Request("http://localhost/api/metrics"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns application and Node.js metrics to an authorized scraper", async () => {
    const response = await GET(
      new Request("http://localhost/api/metrics", {
        headers: {
          authorization: "Bearer test-metrics-token-with-sufficient-length",
        },
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("knowtrace_build_info");
    expect(body).toContain("knowtrace_database_ready 1");
    expect(body).toContain("knowtrace_process_resident_memory_bytes");
    expect(body).toContain("knowtrace_metrics_scrapes_total");
  });
});
