import { describe, expect, it } from "vitest";

import { bearerTokenFrom, isNativeClientRequest } from "./client-mode";

function requestWith(headers: Record<string, string>) {
  return new Request("http://localhost/api/v1/captures", { headers });
}

describe("native client detection", () => {
  it("detects the native client header case-insensitively", () => {
    expect(isNativeClientRequest(requestWith({ "x-client": "native" }))).toBe(true);
    expect(isNativeClientRequest(requestWith({ "x-client": " Native " }))).toBe(true);
    expect(isNativeClientRequest(requestWith({ "x-client": "web" }))).toBe(false);
    expect(isNativeClientRequest(requestWith({}))).toBe(false);
  });
});

describe("bearer token extraction", () => {
  it("extracts a bearer token", () => {
    expect(bearerTokenFrom(requestWith({ authorization: "Bearer access.jwt" }))).toBe(
      "access.jwt",
    );
    expect(bearerTokenFrom(requestWith({ authorization: "bearer access.jwt" }))).toBe(
      "access.jwt",
    );
  });

  it("returns null for missing or non-bearer credentials", () => {
    expect(bearerTokenFrom(requestWith({}))).toBeNull();
    expect(bearerTokenFrom(requestWith({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
    expect(bearerTokenFrom(requestWith({ authorization: "Bearer" }))).toBeNull();
    expect(bearerTokenFrom(requestWith({ authorization: "Bearer   " }))).toBeNull();
  });
});
