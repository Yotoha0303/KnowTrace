"use client";

export const ACCESS_TOKEN_HEADER = "x-knowtrace-access-token";
export const WORKSPACE_ID_HEADER = "x-knowtrace-workspace-id";

export function isNativeClientRequest(request: Request): boolean {
  return request.headers.get("x-client")?.trim().toLowerCase() === "native";
}

export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length ? token : null;
}
