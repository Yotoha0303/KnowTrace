import process from "node:process";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const configuredThreshold = Number(process.env.AI_RUNNING_STALE_AFTER_MS ?? 300_000);
const staleAfterMs = Number.isFinite(configuredThreshold)
  ? Math.min(Math.max(Math.trunc(configuredThreshold), 60_000), 86_400_000)
  : 300_000;
const client = postgres(connectionString, { max: 1 });

try {
  const recovered = await client`
    UPDATE ai_processing_runs
    SET status = 'failed',
        error_code = 'AI_RUN_INTERRUPTED',
        completed_at = now(),
        latency_ms = LEAST(
          2147483647,
          GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at)) * 1000)
        )::integer
    WHERE status = 'running'
      AND started_at < now() - ${staleAfterMs} * interval '1 millisecond'
    RETURNING id
  `;
  console.log(`Recovered ${recovered.length} interrupted AI run(s)`);
} finally {
  await client.end();
}
