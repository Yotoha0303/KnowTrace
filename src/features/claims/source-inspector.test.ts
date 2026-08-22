import { describe, expect, it } from "vitest";

import { inspectEvidenceSource } from "./source-inspector";
import {
  extractInspectableContent,
  isPublicNetworkAddress,
  parseInspectableSourceUrl,
  sourceContainsExcerpt,
} from "./source-policy";

describe("evidence source security policy", () => {
  it("allows public addresses and blocks private or reserved ranges", () => {
    expect(isPublicNetworkAddress("93.184.216.34")).toBe(true);
    expect(isPublicNetworkAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPublicNetworkAddress("127.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("172.18.0.1")).toBe(false);
    expect(isPublicNetworkAddress("::1")).toBe(false);
    expect(isPublicNetworkAddress("2001:db8::1")).toBe(false);
  });

  it("blocks local hosts, credentials, and non-standard ports", () => {
    expect(() => parseInspectableSourceUrl("http://localhost/source")).toThrow();
    expect(() => parseInspectableSourceUrl("https://user:pass@example.com/source")).toThrow();
    expect(() => parseInspectableSourceUrl("https://example.com:8443/source")).toThrow();
    expect(parseInspectableSourceUrl("https://example.com/source").hostname).toBe(
      "example.com",
    );
  });
});

describe("evidence source inspection", () => {
  it("extracts readable HTML and matches normalized excerpts", () => {
    const content = extractInspectableContent(
      "<html><head><title>研究 &amp; 结论</title><style>hidden</style></head><body><p>持续复盘</p><p>能够提高效率</p></body></html>",
      "text/html",
    );
    expect(content.title).toBe("研究 & 结论");
    expect(content.text).not.toContain("hidden");
    expect(sourceContainsExcerpt(content.text, "持续复盘 能够提高效率")).toBe(true);
  });

  it("records a successful immutable snapshot without real network access", async () => {
    const result = await inspectEvidenceSource(
      {
        sourceUrl: "https://example.com/report",
        excerpt: "复盘组效率提高",
      },
      {
        resolveAddress: async () => ({ address: "93.184.216.34", family: 4 }),
        request: async () => ({
          statusCode: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          body: Buffer.from("<title>研究报告</title><p>复盘组效率提高</p>"),
        }),
      },
    );

    expect(result).toMatchObject({
      status: "passed",
      finalUrl: "https://example.com/report",
      fetchedTitle: "研究报告",
      excerptMatch: true,
      httpStatus: 200,
    });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("revalidates redirect targets and blocks redirects to private networks", async () => {
    const result = await inspectEvidenceSource(
      { sourceUrl: "https://example.com/redirect", excerpt: "内容" },
      {
        resolveAddress: async () => ({ address: "93.184.216.34", family: 4 }),
        request: async () => ({
          statusCode: 302,
          headers: { location: "http://127.0.0.1/admin" },
          body: Buffer.alloc(0),
        }),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "EVIDENCE_SOURCE_PRIVATE_ADDRESS",
    });
  });
});
