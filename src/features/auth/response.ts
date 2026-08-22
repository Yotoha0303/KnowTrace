import { NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  authCookieSecure,
  REFRESH_TOKEN_COOKIE,
  type AccessSession,
} from "./go-user-system";

const baseCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: authCookieSecure(),
  path: "/",
});

export function setSessionCookies(
  response: NextResponse,
  session: AccessSession,
  refreshToken?: string,
) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, session.access_token, {
    ...baseCookieOptions(),
    maxAge: session.access_token_expires_in,
  });
  if (refreshToken) {
    response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...baseCookieOptions(),
      maxAge: session.refresh_token_expires_in,
    });
  }
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0,
  });
}
