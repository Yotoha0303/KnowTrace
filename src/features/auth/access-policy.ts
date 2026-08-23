export type DataAccessScope = {
  actorId: string;
  actorName: string;
  isAdmin: boolean;
};

export function canAccessOwner(scope: DataAccessScope, createdById: string): boolean {
  return scope.isAdmin || createdById === scope.actorId;
}
