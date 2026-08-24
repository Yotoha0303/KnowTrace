import { describe, expect, it } from "vitest";

import {
  DEFAULT_CC_SWITCH_BASE_URL,
  ccSwitchHealthURL,
  ccSwitchModelsURL,
  ccSwitchStatusURL,
  firstCCSwitchModelId,
  normalizeCCSwitchBaseURL,
  parseCCSwitchProviderStatus,
  supportsCCSwitchDirectMessages,
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

  it("builds local CC-Switch service endpoints", () => {
    expect(ccSwitchHealthURL(DEFAULT_CC_SWITCH_BASE_URL)).toBe(
      "http://host.docker.internal:15721/health",
    );
    expect(ccSwitchStatusURL(DEFAULT_CC_SWITCH_BASE_URL)).toBe(
      "http://host.docker.internal:15721/status",
    );
    expect(ccSwitchModelsURL(DEFAULT_CC_SWITCH_BASE_URL)).toBe(
      "http://host.docker.internal:15721/v1/models",
    );
  });

  it("reads the current provider even before an app route target is active", () => {
    expect(
      parseCCSwitchProviderStatus({
        current_provider: "DeepSeek",
        current_provider_id: "provider-deepseek",
        active_targets: [],
      }),
    ).toEqual({
      appType: null,
      providerId: "provider-deepseek",
      providerName: "DeepSeek",
      routeActive: false,
    });
  });

  it("prefers an active Codex route target over the generic current provider", () => {
    expect(
      parseCCSwitchProviderStatus({
        current_provider: "DeepSeek",
        current_provider_id: "provider-deepseek",
        active_targets: [
          {
            app_type: "codex",
            provider_id: "provider-deepseek",
            provider_name: "DeepSeek",
          },
        ],
      }),
    ).toEqual({
      appType: "codex",
      providerId: "provider-deepseek",
      providerName: "DeepSeek",
      routeActive: true,
    });
  });

  it("keeps direct Messages compatibility for Codex and DeepSeek only", () => {
    expect(supportsCCSwitchDirectMessages("Codex")).toBe(true);
    expect(supportsCCSwitchDirectMessages("DeepSeek")).toBe(true);
    expect(supportsCCSwitchDirectMessages("Unknown Provider")).toBe(false);
  });

  it("reads the current CC-Switch Codex catalog model id", () => {
    expect(
      firstCCSwitchModelId({
        models: [{ slug: "deepseek-v4-flash", display_name: "DeepSeek V4 Flash" }],
      }),
    ).toBe("deepseek-v4-flash");
    expect(
      firstCCSwitchModelId({
        models: [{ model: "deepseek-v4-pro", slug: "legacy-slug" }],
      }),
    ).toBe("deepseek-v4-pro");
  });

  it("keeps compatibility with OpenAI-style model lists", () => {
    expect(firstCCSwitchModelId({ data: [{ id: "gpt-5.6-luna" }] })).toBe(
      "gpt-5.6-luna",
    );
    expect(firstCCSwitchModelId({ models: [] })).toBeNull();
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
