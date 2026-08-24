export type DataAccessScope = {
  actorId: string;
  actorName: string;
  isAdmin: boolean;
};

export function canAccessOwner(scope: DataAccessScope, createdById: string): boolean {
  return scope.isAdmin || createdById === scope.actorId;
}

export function canReadCapture(
  scope: DataAccessScope,
  createdById: string,
  visibility: "private" | "shared",
): boolean {
  return canAccessOwner(scope, createdById) || visibility === "shared";
}
