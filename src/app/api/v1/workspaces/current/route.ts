import { z } from "zod";

import {
  apiSuccess,
  handleApiError,
  parseJson,
} from "@/features/api/http";
import { currentDataAccessScope } from "@/features/auth/access";
import { requireWorkspaceMembership } from "@/features/workspace/service";
import { CURRENT_WORKSPACE_COOKIE } from "@/shared/workspace";

export const dynamic = "force-dynamic";

const switchWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
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

export async function POST(request: Request) {
  const parsed = await parseJson(request, switchWorkspaceSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const scope = await currentDataAccessScope();
    const workspace = await requireWorkspaceMembership(
      scope.actorId,
      parsed.data.workspaceId,
    );
    const response = apiSuccess(request, workspace);
    response.cookies.set(CURRENT_WORKSPACE_COOKIE, workspace.workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: requestIsSecure(request),
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    return handleApiError(request, error);
  }
}
