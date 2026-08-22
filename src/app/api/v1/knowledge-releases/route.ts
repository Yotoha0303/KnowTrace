import { z } from "zod";

import {
  apiSuccess,
  handleApiError,
  pageMeta,
  paginationQuerySchema,
  parseInput,
} from "@/features/api/http";
import { listKnowledgeReleases } from "@/features/reliability/queries";

export const dynamic = "force-dynamic";

const querySchema = paginationQuerySchema.extend({ claimId: z.uuid().optional() });

export async function GET(request: Request) {
  const parsed = parseInput(
    request,
    querySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.ok) return parsed.response;
  const { page, limit, claimId } = parsed.data;
  try {
    const rows = await listKnowledgeReleases({
      claimId,
      limit: limit + 1,
      offset: (page - 1) * limit,
    });
    const paged = pageMeta(rows, page, limit);
    return apiSuccess(request, paged.items, { meta: paged.meta });
  } catch (error) {
    return handleApiError(request, error);
  }
}
