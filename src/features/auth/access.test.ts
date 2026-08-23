import { describe, expect, it } from "vitest";

import { canAccessOwner, type DataAccessScope } from "./access-policy";

const member: DataAccessScope = {
  actorId: "go-user:21",
  actorName: "成员甲",
  isAdmin: false,
};

describe("content ownership access", () => {
  it("allows a member to access their own content", () => {
    expect(canAccessOwner(member, "go-user:21")).toBe(true);
  });

  it("prevents one member from accessing another member's content", () => {
    expect(canAccessOwner(member, "go-user:22")).toBe(false);
    expect(canAccessOwner(member, "legacy-local")).toBe(false);
  });

  it("allows an administrator to access every creator's content", () => {
    expect(
      canAccessOwner({ ...member, isAdmin: true }, "go-user:22"),
    ).toBe(true);
    expect(
      canAccessOwner({ ...member, isAdmin: true }, "legacy-local"),
    ).toBe(true);
  });
});
