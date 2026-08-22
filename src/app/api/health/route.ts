import { databaseIsReady } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  if (await databaseIsReady()) {
    return Response.json({ status: "ok", database: "connected" });
  }
  return Response.json(
    { status: "error", database: "unavailable" },
    { status: 503 },
  );
}
