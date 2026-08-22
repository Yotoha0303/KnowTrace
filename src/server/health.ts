import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";

export async function databaseIsReady(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
