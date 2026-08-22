import "server-only";

import { currentAuthenticatedUser } from "./session";
import { isAuthEnabled } from "./go-user-system";

export type ActionActor = {
  id: string;
  name: string;
  authenticated: boolean;
};

export async function currentActionActor(): Promise<ActionActor> {
  if (!isAuthEnabled()) {
    return { id: "local-owner", name: "本地使用者", authenticated: false };
  }
  const user = await currentAuthenticatedUser();
  if (!user) {
    return { id: "anonymous", name: "未登录", authenticated: false };
  }
  return {
    id: `go-user:${user.id}`,
    name: user.nickname.trim() || user.username,
    authenticated: true,
  };
}
