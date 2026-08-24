import "server-only";

import { eq, or } from "drizzle-orm";

import type { DataAccessScope } from "./access-policy";
import { captures } from "@/server/db/schema";

export function captureReadCondition(scope: DataAccessScope) {
  return scope.isAdmin
    ? undefined
    : or(
        eq(captures.createdById, scope.actorId),
        eq(captures.visibility, "shared"),
      );
}

export function captureWriteCondition(scope: DataAccessScope) {
  return scope.isAdmin
    ? undefined
    : eq(captures.createdById, scope.actorId);
}

export function canManageCapture(
  scope: DataAccessScope,
  createdById: string,
): boolean {
  return scope.isAdmin || createdById === scope.actorId;
}
