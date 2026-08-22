import { describe, expect, it } from "vitest";

import {
  DEFAULT_CC_SWITCH_BASE_URL,
  ccSwitchHealthURL,
  normalizeCCSwitchBaseURL,
} from "./connection";

describe("normalizeCCSwitchBaseURL", () => {
  it("normalizes the Docker host service root to /v1", () => {
    expect(
      normalizeCCSwitchBaseURL("http://host.docker.internal:15721/"),
    ).toBe(DEFAULT_CC_SWITCH_BASE_URL);
  });

  it("allows local loopback addresses", () => {
    expect(normalizeCCSwitchBaseURL("http://127.0.0.1:15721/v1")).toBe(
      "http://127.0.0.1:15721/v1",
    );
  });

  it("builds the health endpoint outside the /v1 API prefix", () => {
    expect(ccSwitchHealthURL(DEFAULT_CC_SWITCH_BASE_URL)).toBe(
      "http://host.docker.internal:15721/health",
    );
  });

  it("rejects remote hosts and unrelated paths", () => {
    expect(() =>
      normalizeCCSwitchBaseURL("https://example.com/v1"),
    ).toThrow();
    expect(() =>
      normalizeCCSwitchBaseURL("http://localhost:15721/admin"),
    ).toThrow();
  });
});
