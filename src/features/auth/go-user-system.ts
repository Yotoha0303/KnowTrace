import { z } from "zod";

export const ACCESS_TOKEN_COOKIE = "knowtrace_access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

const authUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1).max(255),
  nickname: z.string().max(255),
  status: z.number().int(),
  last_login_at: z.string().optional(),
});

const accessSessionSchema = z.object({
  access_token: z.string().min(1),
  access_token_expires_in: z.number().int().positive(),
  refresh_token_expires_in: z.number().int().positive(),
});

const loginSessionSchema = accessSessionSchema.extend({
  user: authUserSchema,
});

const authorizationSchema = z.object({
  role_codes: z.array(z.string()),
  permission_codes: z.array(z.string()),
});

const envelopeSchema = z.object({
  code: z.number().int(),
  msg: z.string(),
  data: z.unknown(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type AccessSession = z.infer<typeof accessSessionSchema>;
export type LoginSession = z.infer<typeof loginSessionSchema>;
export type AuthorizationInfo = z.infer<typeof authorizationSchema>;

export type GoAuthResult<T> =
  | { ok: true; data: T; refreshToken: string | null }
  | { ok: false; status: number; code: number | null; message: string };

export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === "true";
}

export function authServiceBaseURL(): string {
  const raw = process.env.AUTH_SERVICE_URL?.trim();
  if (!raw) return "http://host.docker.internal:8082";
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("AUTH_SERVICE_URL 必须是无凭据的 HTTP(S) 地址。");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function requestGoUserSystem<T>(
  path: string,
  dataSchema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<GoAuthResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${authServiceBaseURL()}${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: null,
      message: "登录服务暂时不可用，请稍后重试。",
    };
  }

  const parsedEnvelope = envelopeSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsedEnvelope.success) {
    return {
      ok: false,
      status: 502,
      code: null,
      message: "登录服务返回了无法识别的响应。",
    };
  }
  if (!response.ok || parsedEnvelope.data.code !== 0) {
    return {
      ok: false,
      status: response.status,
      code: parsedEnvelope.data.code,
      message: parsedEnvelope.data.msg || "登录服务请求失败。",
    };
  }

  const parsedData = dataSchema.safeParse(parsedEnvelope.data.data);
  if (!parsedData.success) {
    return {
      ok: false,
      status: 502,
      code: null,
      message: "登录服务响应缺少必要字段。",
    };
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const refreshTokenMatch = setCookie.match(
    /(?:^|,\s*)refresh_token=([^;]*)/i,
  );
  return {
    ok: true,
    data: parsedData.data,
    refreshToken: refreshTokenMatch
      ? decodeURIComponent(refreshTokenMatch[1])
      : null,
  };
}

export function loginWithGoUserSystem(input: {
  username: string;
  password: string;
}): Promise<GoAuthResult<LoginSession>> {
  return requestGoUserSystem(
    "/api/v1/auth/login",
    loginSessionSchema,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function refreshWithGoUserSystem(
  refreshToken: string,
): Promise<GoAuthResult<AccessSession>> {
  return requestGoUserSystem(
    "/api/v1/auth/refresh",
    accessSessionSchema,
    {
      method: "POST",
      headers: { cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken}` },
    },
  );
}

export function logoutFromGoUserSystem(input: {
  accessToken?: string;
  refreshToken: string;
}): Promise<GoAuthResult<null>> {
  return requestGoUserSystem(
    "/api/v1/auth/logout",
    z.null(),
    {
      method: "POST",
      headers: {
        cookie: `${REFRESH_TOKEN_COOKIE}=${input.refreshToken}`,
        ...(input.accessToken
          ? { authorization: `Bearer ${input.accessToken}` }
          : {}),
      },
    },
  );
}

export function getGoUser(
  accessToken: string,
): Promise<GoAuthResult<AuthUser>> {
  return requestGoUserSystem("/api/v1/users/me", authUserSchema, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export function getGoAuthorization(
  accessToken: string,
): Promise<GoAuthResult<AuthorizationInfo>> {
  return requestGoUserSystem(
    "/api/v1/users/me/authorization",
    authorizationSchema,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
}

export function authCookieSecure(): boolean {
  return process.env.AUTH_COOKIE_SECURE === "true";
}
