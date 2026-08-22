import { apiError, apiSuccess, handleApiError } from "@/features/api/http";
import { getSubjectTimeline } from "@/features/subjects/queries";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ subject: string }> },
) {
  const { subject } = await params;
  try {
    const timeline = await getSubjectTimeline(subject);
    return timeline
      ? apiSuccess(request, timeline)
      : apiError(request, 404, {
          code: "SUBJECT_NOT_FOUND",
          message: "没有找到这个描述对象的记录。",
        });
  } catch (error) {
    return handleApiError(request, error);
  }
}
