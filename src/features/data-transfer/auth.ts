import "server-only";

import { currentAuthContext } from "@/features/auth/session";
import { isAuthEnabled } from "@/features/auth/go-user-system";

export type TransferActor = { id: string; name: string };

export async function currentTransferActor(): Promise<TransferActor | null> {
  if (!isAuthEnabled()) return { id: "local", name: "本地用户" };
  const context = await currentAuthContext();
  if (!context) return null;
  return {
    id: String(context.user.id),
    name: context.user.nickname || context.user.username,
  };
}
