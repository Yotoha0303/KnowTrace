import "server-only";

import { cookies } from "next/headers";

import {
  ACCESS_TOKEN_COOKIE,
  getGoAuthorization,
  getGoUser,
  isAuthEnabled,
  REFRESH_TOKEN_COOKIE,
  type AuthorizationInfo,
  type AuthUser,
} from "./go-user-system";

export type AuthContext = {
  accessToken: string;
  authorization: AuthorizationInfo;
  user: AuthUser;
};

export async function currentAccessToken(): Promise<string | null> {
  if (!isAuthEnabled()) return null;
  return (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export async function currentAuthContext(): Promise<AuthContext | null> {
  const accessToken = await currentAccessToken();
  if (!accessToken) return null;
  const [user, authorization] = await Promise.all([
    getGoUser(accessToken),
    getGoAuthorization(accessToken),
  ]);
  if (!user.ok || !authorization.ok) return null;
  return { accessToken, user: user.data, authorization: authorization.data };
}

export async function clearCurrentSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
}

export async function currentAuthenticatedUser(): Promise<AuthUser | null> {
  const accessToken = await currentAccessToken();
  if (!accessToken) return null;
  const result = await getGoUser(accessToken);
  return result.ok ? result.data : null;
}

export async function requireAuthenticatedUser(): Promise<AuthUser | null> {
  if (!isAuthEnabled()) return null;
  return currentAuthenticatedUser();
}
