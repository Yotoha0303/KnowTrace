import "server-only";

import { cookies } from "next/headers";

import {
  ACCESS_TOKEN_COOKIE,
  getGoUser,
  isAuthEnabled,
  type AuthUser,
} from "./go-user-system";

export async function currentAuthenticatedUser(): Promise<AuthUser | null> {
  if (!isAuthEnabled()) return null;
  const accessToken = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return null;
  const result = await getGoUser(accessToken);
  return result.ok ? result.data : null;
}

export async function requireAuthenticatedUser(): Promise<AuthUser | null> {
  if (!isAuthEnabled()) return null;
  return currentAuthenticatedUser();
}
