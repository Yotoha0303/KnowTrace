import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { topicSyntheses } from "@/server/db/schema";

import { topicSynthesisPayloadSchema, type TopicSynthesisPayload } from "./schema";
import { topicSourceHash } from "./invariants";
import { buildTopicSourceSnapshot } from "./service";

export type TopicSynthesisDTO = {
  id: string;
  provider: string;
  model: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  decision: "pending" | "accepted" | "rejected";
  payload: TopicSynthesisPayload | null;
  isStale: boolean;
  sourceCaptureCount: number;
  sourceClaimCount: number;
  sourceTruncated: boolean;
  captureRefs: Array<{ id: string; title: string | null }>;
  claimRefs: Array<{ id: string; captureId: string; statement: string }>;
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export async function getTopicSynthesisState(categoryId: string): Promise<{
  currentSourceHash: string;
  currentCaptureCount: number;
  history: TopicSynthesisDTO[];
}> {
  const [snapshot, rows] = await Promise.all([
    buildTopicSourceSnapshot(categoryId),
    db
      .select()
      .from(topicSyntheses)
      .where(eq(topicSyntheses.categoryId, categoryId))
      .orderBy(desc(topicSyntheses.createdAt))
      .limit(10),
  ]);
  const currentSourceHash = topicSourceHash(snapshot);
  return {
    currentSourceHash,
    currentCaptureCount: snapshot.captures.length,
    history: rows.map((row) => {
      const source = row.sourceSnapshot as Partial<{
        captures: Array<{ id: string; title: string | null }>;
        claims: Array<{ id: string; captureId: string; statement: string }>;
        truncated: boolean;
      }>;
      const parsedPayload = row.payload
        ? topicSynthesisPayloadSchema.safeParse(row.payload)
        : null;
      return {
        id: row.id,
        provider: row.provider,
        model: row.model,
        status: row.status,
        decision: row.decision,
        payload: parsedPayload?.success ? parsedPayload.data : null,
        isStale: row.sourceHash !== currentSourceHash,
        sourceCaptureCount: Array.isArray(source.captures) ? source.captures.length : 0,
        sourceClaimCount: Array.isArray(source.claims) ? source.claims.length : 0,
        sourceTruncated: source.truncated === true,
        captureRefs: Array.isArray(source.captures)
          ? source.captures.map(({ id, title }) => ({ id, title }))
          : [],
        claimRefs: Array.isArray(source.claims)
          ? source.claims.map(({ id, captureId, statement }) => ({ id, captureId, statement }))
          : [],
        latencyMs: row.latencyMs,
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      };
    }),
  };
}
