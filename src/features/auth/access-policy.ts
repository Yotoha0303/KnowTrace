export type ActorAccessIdentity = {
  actorId: string;
  actorName: string;
  isAdmin: boolean;
};

export type DataAccessScope = ActorAccessIdentity & {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceRole: "owner" | "member";
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
