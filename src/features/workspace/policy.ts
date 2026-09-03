export type WorkspaceMembershipRole = "owner" | "member";

export type WorkspaceMembershipIdentity = {
  workspaceId: string;
  actorId: string;
  role: WorkspaceMembershipRole;
};

export function hasWorkspaceMembership(
  membership: WorkspaceMembershipIdentity | null | undefined,
  actorId: string,
  workspaceId: string,
): boolean {
  return Boolean(
    membership &&
      membership.actorId === actorId &&
      membership.workspaceId === workspaceId,
  );
}

export function selectWorkspaceMembership(
  memberships: readonly WorkspaceMembershipIdentity[],
  actorId: string,
  preferredWorkspaceId?: string | null,
): WorkspaceMembershipIdentity | null {
  const actorMemberships = memberships.filter(
    (membership) => membership.actorId === actorId,
  );
  if (preferredWorkspaceId) {
    return (
      actorMemberships.find(
        (membership) => membership.workspaceId === preferredWorkspaceId,
      ) ?? null
    );
  }
  if (actorMemberships.length === 0) return null;
  return (
    actorMemberships.find((membership) => membership.role === "owner") ??
    actorMemberships[0] ??
    null
  );
}
