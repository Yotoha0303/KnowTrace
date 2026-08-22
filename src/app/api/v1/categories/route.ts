import { z } from "zod";

import { apiSuccess, handleApiError, parseInput } from "@/features/api/http";
import { listCategories } from "@/features/capture/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export async function GET(request: Request) {
  const parsed = parseInput(
    request,
    querySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.ok) return parsed.response;
  try {
    return apiSuccess(request, await listCategories(parsed.data.includeArchived));
  } catch (error) {
    return handleApiError(request, error);
  }
}
