import { eq } from "drizzle-orm";

import { readEvidenceImage } from "@/features/claims/image-storage";
import { db } from "@/server/db/client";
import { evidenceAttachments } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
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
