import { z } from "zod";

import {
  apiSuccess,
  handleApiError,
  parseJson,
} from "@/features/api/http";
import { currentDataAccessScope } from "@/features/auth/access";
import {
  createWorkspaceForActor,
  deleteEmptyWorkspaceForActor,
  listActorWorkspaces,
} from "@/features/workspace/service";
import {
  CURRENT_WORKSPACE_COOKIE,
  LEGACY_DEFAULT_WORKSPACE_ID,
} from "@/shared/workspace";

export const dynamic = "force-dynamic";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const deleteWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
  confirmationName: z.string().trim().min(1).max(100),
});

function requestIsSecure(request: Request): boolean {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto) return forwardedProto === "https";
  return new URL(request.url).protocol === "https:";
}

export async function GET(request: Request) {
  try {
    const scope = await currentDataAccessScope();
    const workspaces = await listActorWorkspaces(scope.actorId);
    return apiSuccess(request, {
      currentWorkspaceId: scope.workspaceId,
      workspaces,
    });
  } catch (error) {
    return handleApiError(request, error);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, createWorkspaceSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const scope = await currentDataAccessScope();
    const workspace = await createWorkspaceForActor({
      actorId: scope.actorId,
      actorName: scope.actorName,
      name: parsed.data.name,
    });
    return apiSuccess(request, workspace, { status: 201 });
  } catch (error) {
    return handleApiError(request, error);
  }
}

export async function DELETE(request: Request) {
  const parsed = await parseJson(request, deleteWorkspaceSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const scope = await currentDataAccessScope();
    const result = await deleteEmptyWorkspaceForActor({
      actorId: scope.actorId,
      workspaceId: parsed.data.workspaceId,
      confirmationName: parsed.data.confirmationName,
    });
    const nextWorkspaceId =
      scope.workspaceId === result.deletedWorkspaceId
        ? LEGACY_DEFAULT_WORKSPACE_ID
        : scope.workspaceId;
    const response = apiSuccess(request, {
      ...result,
      currentWorkspaceId: nextWorkspaceId,
    });
    if (scope.workspaceId === result.deletedWorkspaceId) {
      response.cookies.set(CURRENT_WORKSPACE_COOKIE, LEGACY_DEFAULT_WORKSPACE_ID, {
        httpOnly: true,
        sameSite: "lax",
        secure: requestIsSecure(request),
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  } catch (error) {
    return handleApiError(request, error);
  }
}
