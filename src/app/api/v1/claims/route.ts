import { z } from "zod";

import {
  apiSuccess,
  handleApiError,
  pageMeta,
  paginationQuerySchema,
  parseInput,
} from "@/features/api/http";
import { listClaims } from "@/features/capture/queries";

export const dynamic = "force-dynamic";

const querySchema = paginationQuerySchema.extend({
  query: z.string().max(100).optional(),
  status: z
    .enum(["candidate", "investigating", "ready_for_review", "concluded", "withdrawn"])
    .optional(),
});

export async function GET(request: Request) {
  const parsed = parseInput(
    request,
    querySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.ok) return parsed.response;
  const { page, limit, query, status } = parsed.data;
  try {
    const rows = await listClaims({
      query,
      status,
      limit: limit + 1,
      offset: (page - 1) * limit,
    });
    const paged = pageMeta(rows, page, limit);
    return apiSuccess(request, paged.items, { meta: paged.meta });
  } catch (error) {
    return handleApiError(request, error);
  }
}
