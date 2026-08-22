import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const migrationsDir = path.resolve(process.cwd(), "drizzle");
const client = postgres(connectionString, { max: 1 });

try {
  await client`
    CREATE TABLE IF NOT EXISTS knowtrace_migrations (
      filename text PRIMARY KEY,
      checksum varchar(64) NOT NULL,
      applied_at timestamptz DEFAULT now() NOT NULL
    )
  `;

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const fullPath = path.join(migrationsDir, filename);
    const content = await readFile(fullPath, "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const [existing] = await client`
      SELECT checksum FROM knowtrace_migrations WHERE filename = ${filename}
    `;

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration ${filename} changed after it was applied`);
      }
      continue;
    }

    const statements = content
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    await client.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
      await transaction`
        INSERT INTO knowtrace_migrations (filename, checksum)
        VALUES (${filename}, ${checksum})
      `;
    });

    console.log(`Applied ${filename}`);
  }
} finally {
  await client.end();
}
