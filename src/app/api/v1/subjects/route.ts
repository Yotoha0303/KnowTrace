import { apiSuccess, handleApiError } from "@/features/api/http";
import { listSubjectSummaries } from "@/features/subjects/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return apiSuccess(request, await listSubjectSummaries());
  } catch (error) {
    return handleApiError(request, error);
  }
}
