import { describe, expect, it } from "vitest";

import {
  hasWorkspaceMembership,
  selectWorkspaceMembership,
  type WorkspaceMembershipIdentity,
} from "./policy";

const memberships: WorkspaceMembershipIdentity[] = [
  { workspaceId: "workspace-a", actorId: "actor-1", role: "member" },
  { workspaceId: "workspace-b", actorId: "actor-1", role: "owner" },
  { workspaceId: "workspace-a", actorId: "actor-2", role: "owner" },
];

describe("workspace policy", () => {
  it("requires both actor and workspace to match", () => {
    expect(hasWorkspaceMembership(memberships[0], "actor-1", "workspace-a")).toBe(true);
    expect(hasWorkspaceMembership(memberships[0], "actor-2", "workspace-a")).toBe(false);
    expect(hasWorkspaceMembership(memberships[0], "actor-1", "workspace-b")).toBe(false);
  });

  it("honors a preferred workspace only when the actor is a member", () => {
    expect(selectWorkspaceMembership(memberships, "actor-1", "workspace-a")).toEqual(
      memberships[0],
    );
    expect(selectWorkspaceMembership(memberships, "actor-1", "workspace-missing")).toBeNull();
  });

  it("uses an owned workspace as the compatibility default", () => {
    expect(selectWorkspaceMembership(memberships, "actor-1")).toEqual(memberships[1]);
    expect(selectWorkspaceMembership(memberships, "actor-missing")).toBeNull();
  });
});
