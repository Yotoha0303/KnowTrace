import "server-only";

import { currentDataAccessScope } from "@/features/auth/access";

export type TransferActor = { id: string; name: string; isAdmin: boolean };

export async function currentTransferActor(): Promise<TransferActor | null> {
  try {
    const scope = await currentDataAccessScope();
    return { id: scope.actorId, name: scope.actorName, isAdmin: scope.isAdmin };
  } catch {
    return null;
  }
}
