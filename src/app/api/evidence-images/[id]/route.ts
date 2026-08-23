import { eq } from "drizzle-orm";

import { readEvidenceImage } from "@/features/claims/image-storage";
import { isAuthEnabled } from "@/features/auth/go-user-system";
import { requireAuthenticatedUser } from "@/features/auth/session";
import { db } from "@/server/db/client";
import { evidenceAttachments } from "@/server/db/schema";
import { requireAttachmentAccess } from "@/features/auth/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (isAuthEnabled() && !(await requireAuthenticatedUser())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    await requireAttachmentAccess(id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const [attachment] = await db
    .select({
      storagePath: evidenceAttachments.storagePath,
      mimeType: evidenceAttachments.mimeType,
      byteSize: evidenceAttachments.byteSize,
    })
    .from(evidenceAttachments)
    .where(eq(evidenceAttachments.id, id))
    .limit(1);
  if (!attachment) return new Response("Not found", { status: 404 });

  try {
    const image = await readEvidenceImage(attachment.storagePath);
    return new Response(image, {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(attachment.byteSize),
        "Content-Type": attachment.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
