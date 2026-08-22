import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  knowTraceSql?: ReturnType<typeof postgres>;
};

export const sqlClient =
  globalForDb.knowTraceSql ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 10 : 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.knowTraceSql = sqlClient;
}

export const db = drizzle(sqlClient, { schema });
