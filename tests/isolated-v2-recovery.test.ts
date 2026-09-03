import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const SOURCE_APP = "http://127.0.0.1:3301";
const TARGET_APP = "http://127.0.0.1:3302";
const SOURCE_DATABASE = "postgres://knowtrace:isolated@127.0.0.1:15433/knowtrace_source";
const TARGET_DATABASE = "postgres://knowtrace:isolated@127.0.0.1:15434/knowtrace_target";

const captureId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const supportEvidenceId = "44444444-4444-4444-8444-444444444444";
const contradictEvidenceId = "55555555-5555-4555-8555-555555555555";
const webCheckId = "66666666-6666-4666-8666-666666666666";
const attachmentId = "77777777-7777-4777-8777-777777777777";
const attachmentCheckId = "88888888-8888-4888-8888-888888888888";
const reviewId = "99999999-9999-4999-8999-999999999999";
const defaultWorkspaceId = "00000000-0000-4000-8000-000000000001";
const secondaryWorkspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberWorkspaceId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const defaultWorkspaceCategoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secondaryWorkspaceCategoryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const pngSha256 = createHash("sha256").update(pngBytes).digest("hex");

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function isReady(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/health/ready`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function resetDatabase(sql: postgres.Sql) {
  const rows = await sql<{ tablename: string }[]>`
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in (
        'knowtrace_migrations',
        'workspaces',
        'workspace_memberships'
      )
    order by tablename
  `;
  if (rows.length) {
    const identifiers = rows
      .map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
      .join(", ");
    await sql.unsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
  }
  await sql`delete from workspace_memberships where workspace_id <> ${defaultWorkspaceId}`;
  await sql`delete from workspaces where id <> ${defaultWorkspaceId}`;
}

async function cleanDirectory(directory: string) {
  await mkdir(directory, { recursive: true });
  for (const entry of await readdir(directory)) {
    await rm(path.join(directory, entry), { recursive: true, force: true });
  }
}

async function seedSource(sql: postgres.Sql) {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const sourceContent =
    "隔离恢复测试：供应商公告称功能 A 已正式上线。另一份现场图片显示部分终端仍未出现功能 A。";
  const sourceExcerpt = "供应商公告称功能 A 已正式上线";

  await sql`
    insert into categories (
      id, name, normalized_name, description, status,
      created_by_id, created_by_name, created_at, updated_at
    ) values (
      ${categoryId}, '隔离恢复', '隔离恢复', 'v2 recovery fixture', 'active',
      'local-owner', '本地使用者', ${now}, ${now}
    )
  `;

  await sql`
    insert into captures (
      id, title, subject, content, occurred_at, content_type, status, visibility,
      version, idempotency_key, idempotency_hash, import_fingerprint,
      created_by_id, created_by_name, created_at, updated_at
    ) values (
      ${captureId}, 'v2 隔离恢复验收', '功能 A', ${sourceContent}, ${now},
      'observation', 'active', 'shared', 3,
      'isolated-source-capture', ${hash("isolated-source-capture")}, null,
      'local-owner', '本地使用者', ${now}, ${now}
    )
  `;

  await sql`
    insert into capture_revisions (
      capture_id, version, title, subject, content, content_type, occurred_at, created_at
    ) values (
      ${captureId}, 3, 'v2 隔离恢复验收', '功能 A', ${sourceContent},
      'observation', ${now}, ${now}
    )
  `;

  await sql`
    insert into capture_categories (capture_id, category_id, assigned_by, created_at)
    values (${captureId}, ${categoryId}, 'manual', ${now})
  `;

  await sql`
    insert into claims (
      id, capture_id, source_suggestion_id, source_capture_version,
      statement, statement_hash, source_excerpt, falsification_criteria,
      status, created_at, updated_at
    ) values (
      ${claimId}, ${captureId}, null, 2,
      '功能 A 已经在全部终端正式上线。', ${hash("source-claim")}, ${sourceExcerpt},
      '如果任一受支持终端仍未出现功能 A，则该全量上线主张被证伪。',
      'concluded', ${now}, ${now}
    )
  `;

  await sql`
    insert into claim_evidence (
      id, claim_id, source_url, source_title, excerpt, stance, note, version,
      review_status, reviewed_at, source_check_status, source_excerpt_match,
      source_checked_at, latest_source_check_id, created_at, updated_at
    ) values
    (
      ${supportEvidenceId}, ${claimId}, 'https://example.com/release', '供应商公告',
      '功能 A 已正式上线。', 'supports', '官方公告支持上线事实。', 2,
      'unreviewed', null, 'unchecked', null, null, null, ${now}, ${now}
    ),
    (
      ${contradictEvidenceId}, ${claimId}, '', '现场终端截图',
      '该终端界面中未出现功能 A。', 'contradicts', '无公共 URL，使用图片人工核验。', 1,
      'unreviewed', null, 'unchecked', null, null, null, ${now}, ${now}
    )
  `;

  await sql`
    insert into evidence_attachments (
      id, evidence_id, original_name, storage_path, mime_type, byte_size, sha256, created_at
    ) values (
      ${attachmentId}, ${contradictEvidenceId}, 'terminal.png',
      ${attachmentId + ".png"}, 'image/png', ${pngBytes.byteLength}, ${pngSha256}, ${now}
    )
  `;

  const webHash = hash("web-source-content");
  const attachmentSnapshot = [
    {
      id: attachmentId,
      originalName: "terminal.png",
      mimeType: "image/png",
      byteSize: pngBytes.byteLength,
      sha256: pngSha256,
    },
  ];

  await sql`
    insert into evidence_source_checks (
      id, evidence_id, verification_method, requested_url, final_url, status,
      http_status, content_type, content_hash, fetched_title, excerpt_match,
      response_bytes, error_code, attachment_snapshot, verification_note, checked_at
    ) values (
      ${webCheckId}, ${supportEvidenceId}, 'web', 'https://example.com/release',
      'https://example.com/release', 'passed', 200, 'text/html', ${webHash},
      '供应商公告', true, 128, null, null, null, ${now}
    )
  `;

  await sql`
    insert into evidence_source_checks (
      id, evidence_id, verification_method, requested_url, final_url, status,
      http_status, content_type, content_hash, fetched_title, excerpt_match,
      response_bytes, error_code, attachment_snapshot, verification_note, checked_at
    ) values (
      ${attachmentCheckId}, ${contradictEvidenceId}, 'manual_attachment', '',
      'attachment://terminal.png', 'passed', null,
      'application/vnd.knowtrace.evidence-attachments+json', ${pngSha256}, null,
      true, ${pngBytes.byteLength}, null, ${sql.json(attachmentSnapshot)},
      '已查看全部附件并确认摘录与附件内容一致。', ${now}
    )
  `;

  await sql`
    update claim_evidence
    set review_status = 'accepted', reviewed_at = ${now},
        source_check_status = 'passed', source_excerpt_match = true,
        source_checked_at = ${now}, latest_source_check_id = ${webCheckId}
    where id = ${supportEvidenceId}
  `;
  await sql`
    update claim_evidence
    set review_status = 'accepted', reviewed_at = ${now},
        source_check_status = 'passed', source_excerpt_match = true,
        source_checked_at = ${now}, latest_source_check_id = ${attachmentCheckId}
    where id = ${contradictEvidenceId}
  `;

  await sql`
    insert into claim_reviews (
      id, claim_id, review_number, assessment, rationale, limitations,
      reviewer_id, reviewer_name, created_at
    ) values (
      ${reviewId}, ${claimId}, 1, 'supported',
      '公告支持上线，但现场反例说明“全部终端”仍存在边界。',
      '样本仅覆盖一个现场终端。', 'reviewer:isolated', '隔离验收审核者', ${now}
    )
  `;

  await sql`
    insert into claim_review_evidence (
      review_id, evidence_id, source_check_id, stance, source_url,
      source_title, excerpt, final_url, source_content_hash, source_checked_at
    ) values
    (
      ${reviewId}, ${supportEvidenceId}, ${webCheckId}, 'supports',
      'https://example.com/release', '供应商公告', '功能 A 已正式上线。',
      'https://example.com/release', ${webHash}, ${now}
    ),
    (
      ${reviewId}, ${contradictEvidenceId}, ${attachmentCheckId}, 'contradicts',
      '', '现场终端截图', '该终端界面中未出现功能 A。',
      'attachment://terminal.png', ${pngSha256}, ${now}
    )
  `;
}

async function uploadPreview(zip: Buffer) {
  const fileBytes = new Uint8Array(zip.byteLength);
  fileBytes.set(zip);
  const formData = new FormData();
  formData.set(
    "file",
    new File([fileBytes], "isolated-v2-export.zip", { type: "application/zip" }),
  );
  const response = await fetch(`${TARGET_APP}/api/data-transfer/v2/import/preview`, {
    method: "POST",
    body: formData,
  });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data as {
    runId: string;
    status: "previewed";
    summary: {
      valid: boolean;
      base: {
        recordsTotal: number;
        recordsToCreate: number;
        recordsToSkip: number;
      };
      knowledge: {
        claims: { toCreate: number; toSkip: number; toRepair: number };
        evidence: { toCreate: number; toSkip: number; toRepair: number };
        attachments: { toCreate: number; toSkip: number; toRepair: number };
        historicalContext: {
          sourceChecks: number;
          attachmentChecks: number;
          reviews: number;
          reviewEvidenceRelationships: number;
        };
        downgraded: {
          claimTrustStates: number;
          claimSourceVersions: number;
          evidenceVersions: number;
          evidenceReviewStates: number;
          evidenceCheckStates: number;
          reviews: number;
        };
      };
    };
  };
}

async function confirm(runId: string) {
  const response = await fetch(
    `${TARGET_APP}/api/data-transfer/v2/import/${runId}/confirm`,
    { method: "POST" },
  );
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data.result as {
    recordsCreated: number;
    recordsSkipped: number;
    claimsCreated: number;
    claimsSkipped: number;
    evidenceCreated: number;
    evidenceSkipped: number;
    attachmentsCreated: number;
    attachmentsSkipped: number;
  };
}

describe("v2 isolated instance recovery", () => {
  it("exports from one real instance, restores into an empty second instance, serves the image, and stays idempotent", async () => {
    if (!(await isReady(SOURCE_APP)) || !(await isReady(TARGET_APP))) {
      console.warn(
        "[isolated-v2] SKIP: start tests/isolated-v2/compose.yaml to run the real two-instance recovery test.",
      );
      return;
    }

    console.info("[isolated-v2] RUN: real source/target Compose instances detected.");
    const sourceSql = postgres(SOURCE_DATABASE, { max: 1 });
    const targetSql = postgres(TARGET_DATABASE, { max: 1 });
    const sourceEvidenceDir = path.resolve("tests/isolated-v2/source-uploads/evidence");
    const targetEvidenceDir = path.resolve("tests/isolated-v2/target-uploads/evidence");

    try {
      await resetDatabase(sourceSql);
      await resetDatabase(targetSql);
      await cleanDirectory(sourceEvidenceDir);
      await cleanDirectory(targetEvidenceDir);
      await seedSource(sourceSql);
      await writeFile(path.join(sourceEvidenceDir, `${attachmentId}.png`), pngBytes);

      const exportResponse = await fetch(`${SOURCE_APP}/api/data-transfer/v2/export`);
      expect(exportResponse.status).toBe(200);
      expect(exportResponse.headers.get("content-type")).toContain("application/zip");
      const zip = Buffer.from(await exportResponse.arrayBuffer());
      expect(zip.byteLength).toBeGreaterThan(100);

      const firstPreview = await uploadPreview(zip);
      expect(firstPreview.status).toBe("previewed");
      expect(firstPreview.summary.valid).toBe(true);
      expect(firstPreview.summary.base.recordsTotal).toBe(1);
      expect(firstPreview.summary.base.recordsToCreate).toBe(1);
      expect(firstPreview.summary.knowledge.claims.toCreate).toBe(1);
      expect(firstPreview.summary.knowledge.evidence.toCreate).toBe(2);
      expect(firstPreview.summary.knowledge.attachments.toCreate).toBe(1);
      expect(firstPreview.summary.knowledge.historicalContext).toEqual({
        sourceChecks: 1,
        attachmentChecks: 1,
        reviews: 1,
        reviewEvidenceRelationships: 2,
      });
      expect(firstPreview.summary.knowledge.downgraded.claimTrustStates).toBe(1);
      expect(firstPreview.summary.knowledge.downgraded.claimSourceVersions).toBe(1);
      expect(firstPreview.summary.knowledge.downgraded.evidenceVersions).toBe(1);
      expect(firstPreview.summary.knowledge.downgraded.evidenceReviewStates).toBe(2);
      expect(firstPreview.summary.knowledge.downgraded.evidenceCheckStates).toBe(2);
      expect(firstPreview.summary.knowledge.downgraded.reviews).toBe(1);

      const firstResult = await confirm(firstPreview.runId);
      expect(firstResult.recordsCreated).toBe(1);
      expect(firstResult.claimsCreated).toBe(1);
      expect(firstResult.evidenceCreated).toBe(2);
      expect(firstResult.attachmentsCreated).toBe(1);

      const isolationWorkspaceResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "v2 越权隔离空间" }),
      });
      const isolationWorkspaceBody = await isolationWorkspaceResponse.json();
      expect(
        isolationWorkspaceResponse.status,
        JSON.stringify(isolationWorkspaceBody),
      ).toBe(201);
      const isolationWorkspaceId = isolationWorkspaceBody.data.workspaceId as string;
      const isolationSwitchResponse = await fetch(
        `${TARGET_APP}/api/v1/workspaces/current`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: isolationWorkspaceId }),
        },
      );
      expect(isolationSwitchResponse.status).toBe(200);
      const isolationCookie = (isolationSwitchResponse.headers.get("set-cookie") ?? "")
        .split(";")[0]!;

      const isolatedExportResponse = await fetch(`${TARGET_APP}/api/data-transfer/v2/export`, {
        headers: { cookie: isolationCookie },
      });
      expect(isolatedExportResponse.status).toBe(200);
      const isolatedExport = Buffer.from(await isolatedExportResponse.arrayBuffer());
      const { parsePortablePackageV2 } = await import(
        "../src/features/data-transfer/package-v2"
      );
      const isolatedExportParsed = await parsePortablePackageV2(isolatedExport);
      expect(isolatedExportParsed.payload?.records).toHaveLength(0);
      expect(isolatedExportParsed.payload?.categories).toHaveLength(0);
      expect(isolatedExportParsed.payload?.claims).toHaveLength(0);
      expect(isolatedExportParsed.payload?.evidence).toHaveLength(0);
      expect(isolatedExportParsed.payload?.attachments).toHaveLength(0);

      const targetCaptures = await targetSql`
        select id, version, created_by_id
        from captures
        where created_by_id = 'local-owner'
      `;
      expect(targetCaptures).toHaveLength(1);
      expect(targetCaptures[0]?.version).toBe(1);

      const targetClaims = await targetSql`
        select id, status, source_capture_version
        from claims
      `;
      expect(targetClaims).toHaveLength(1);
      expect(targetClaims[0]?.status).toBe("investigating");
      expect(targetClaims[0]?.source_capture_version).toBe(1);

      const targetEvidence = await targetSql`
        select id, version, review_status, source_check_status,
               source_excerpt_match, latest_source_check_id
        from claim_evidence
        order by source_title
      `;
      expect(targetEvidence).toHaveLength(2);
      for (const evidence of targetEvidence) {
        expect(evidence.version).toBe(1);
        expect(evidence.review_status).toBe("unreviewed");
        expect(evidence.source_check_status).toBe("unchecked");
        expect(evidence.source_excerpt_match).toBeNull();
        expect(evidence.latest_source_check_id).toBeNull();
      }

      const restoredChecks = await targetSql`select count(*)::int as count from evidence_source_checks`;
      const restoredReviews = await targetSql`select count(*)::int as count from claim_reviews`;
      expect(restoredChecks[0]?.count).toBe(0);
      expect(restoredReviews[0]?.count).toBe(0);

      const targetAttachments = await targetSql`
        select id, mime_type, byte_size, sha256
        from evidence_attachments
      `;
      expect(targetAttachments).toHaveLength(1);
      expect(targetAttachments[0]?.mime_type).toBe("image/png");
      expect(targetAttachments[0]?.byte_size).toBe(pngBytes.byteLength);
      expect(targetAttachments[0]?.sha256).toBe(pngSha256);

      const crossWorkspaceImageResponse = await fetch(
        `${TARGET_APP}/api/evidence-images/${targetAttachments[0]?.id}`,
        { headers: { cookie: isolationCookie } },
      );
      expect(crossWorkspaceImageResponse.status).toBe(404);

      const imageResponse = await fetch(
        `${TARGET_APP}/api/evidence-images/${targetAttachments[0]?.id}`,
      );
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/png");
      const restoredImage = Buffer.from(await imageResponse.arrayBuffer());
      expect(restoredImage.equals(pngBytes)).toBe(true);
      expect(createHash("sha256").update(restoredImage).digest("hex")).toBe(pngSha256);

      const secondPreview = await uploadPreview(zip);
      expect(secondPreview.summary.base.recordsToCreate).toBe(0);
      expect(secondPreview.summary.base.recordsToSkip).toBe(1);
      expect(secondPreview.summary.knowledge.claims.toCreate).toBe(0);
      expect(secondPreview.summary.knowledge.claims.toSkip).toBe(1);
      expect(secondPreview.summary.knowledge.evidence.toCreate).toBe(0);
      expect(secondPreview.summary.knowledge.evidence.toSkip).toBe(2);
      expect(secondPreview.summary.knowledge.attachments.toCreate).toBe(0);
      expect(secondPreview.summary.knowledge.attachments.toSkip).toBe(1);

      const crossWorkspaceRunResponse = await fetch(
        `${TARGET_APP}/api/data-transfer/v2/import/${secondPreview.runId}/confirm`,
        { method: "POST", headers: { cookie: isolationCookie } },
      );
      const crossWorkspaceRunBody = await crossWorkspaceRunResponse.json();
      const missingRunResponse = await fetch(
        `${TARGET_APP}/api/data-transfer/v2/import/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/confirm`,
        { method: "POST", headers: { cookie: isolationCookie } },
      );
      const missingRunBody = await missingRunResponse.json();
      expect(crossWorkspaceRunResponse.status).toBe(404);
      expect(missingRunResponse.status).toBe(404);
      expect(crossWorkspaceRunBody.error?.code).toBe("IMPORT_RUN_NOT_FOUND");
      expect(missingRunBody.error?.code).toBe("IMPORT_RUN_NOT_FOUND");

      const secondResult = await confirm(secondPreview.runId);
      expect(secondResult.recordsCreated).toBe(0);
      expect(secondResult.recordsSkipped).toBe(1);
      expect(secondResult.claimsCreated).toBe(0);
      expect(secondResult.claimsSkipped).toBe(1);
      expect(secondResult.evidenceCreated).toBe(0);
      expect(secondResult.evidenceSkipped).toBe(2);
      expect(secondResult.attachmentsCreated).toBe(0);
      expect(secondResult.attachmentsSkipped).toBe(1);

      const directStagingDir = path.resolve("tests/isolated-v2/direct-staging");
      await cleanDirectory(directStagingDir);
      process.env.DATABASE_URL = TARGET_DATABASE;
      process.env.EVIDENCE_UPLOAD_DIR = targetEvidenceDir;
      process.env.DATA_IMPORT_STAGING_DIR = directStagingDir;
      const {
        stagePortablePackageV2Preview,
        confirmPortablePackageV2Import,
      } = await import("../src/features/data-transfer/service-v2");
      const secondActor = {
        id: "go-user:2002",
        name: "隔离验收第二用户",
        isAdmin: false,
        workspaceId: defaultWorkspaceId,
      };
      const secondActorPreview = await stagePortablePackageV2Preview({
        actor: secondActor,
        fileName: "isolated-v2-export.zip",
        buffer: zip,
      });
      expect(secondActorPreview.status).toBe("previewed");
      expect(secondActorPreview.summary.base?.recordsToCreate).toBe(1);
      expect(secondActorPreview.summary.base?.recordsToSkip).toBe(0);
      expect(secondActorPreview.summary.knowledge?.claims.toCreate).toBe(1);
      expect(secondActorPreview.summary.knowledge?.claims.toSkip).toBe(0);
      expect(secondActorPreview.summary.knowledge?.evidence.toCreate).toBe(2);
      expect(secondActorPreview.summary.knowledge?.attachments.toCreate).toBe(1);

      if (!secondActorPreview.runId) {
        throw new Error("第二 actor 的 v2 预检未返回 runId。");
      }
      const secondActorResult = await confirmPortablePackageV2Import(
        secondActorPreview.runId,
        secondActor,
      );
      expect(secondActorResult.result.recordsCreated).toBe(1);
      expect(secondActorResult.result.claimsCreated).toBe(1);
      expect(secondActorResult.result.evidenceCreated).toBe(2);
      expect(secondActorResult.result.attachmentsCreated).toBe(1);

      await targetSql`
        insert into workspaces (
          id, name, slug, created_by_id, created_by_name
        ) values (
          ${secondaryWorkspaceId}, '第二隔离空间', 'isolated-secondary',
          'local-owner', '本地使用者'
        )
        on conflict (id) do update
        set name = excluded.name, slug = excluded.slug,
            created_by_id = excluded.created_by_id,
            created_by_name = excluded.created_by_name
      `;
      const sameActorSecondaryWorkspace = {
        id: "local-owner",
        name: "本地使用者",
        isAdmin: true,
        workspaceId: secondaryWorkspaceId,
      };
      const secondaryWorkspacePreview = await stagePortablePackageV2Preview({
        actor: sameActorSecondaryWorkspace,
        fileName: "isolated-v2-export.zip",
        buffer: zip,
      });
      expect(secondaryWorkspacePreview.status).toBe("previewed");
      expect(secondaryWorkspacePreview.summary.base?.recordsToCreate).toBe(1);
      expect(secondaryWorkspacePreview.summary.base?.recordsToSkip).toBe(0);
      expect(secondaryWorkspacePreview.summary.knowledge?.claims.toCreate).toBe(1);
      expect(secondaryWorkspacePreview.summary.knowledge?.claims.toSkip).toBe(0);
      expect(secondaryWorkspacePreview.summary.knowledge?.evidence.toCreate).toBe(2);
      expect(secondaryWorkspacePreview.summary.knowledge?.attachments.toCreate).toBe(1);
      if (!secondaryWorkspacePreview.runId) {
        throw new Error("第二 Workspace 的 v2 预检未返回 runId。");
      }
      const secondaryWorkspaceResult = await confirmPortablePackageV2Import(
        secondaryWorkspacePreview.runId,
        sameActorSecondaryWorkspace,
      );
      expect(secondaryWorkspaceResult.result.recordsCreated).toBe(1);
      expect(secondaryWorkspaceResult.result.claimsCreated).toBe(1);
      expect(secondaryWorkspaceResult.result.evidenceCreated).toBe(2);
      expect(secondaryWorkspaceResult.result.attachmentsCreated).toBe(1);

      const secondaryWorkspaceRepeat = await stagePortablePackageV2Preview({
        actor: sameActorSecondaryWorkspace,
        fileName: "isolated-v2-export.zip",
        buffer: zip,
      });
      expect(secondaryWorkspaceRepeat.status).toBe("previewed");
      expect(secondaryWorkspaceRepeat.summary.base?.recordsToCreate).toBe(0);
      expect(secondaryWorkspaceRepeat.summary.base?.recordsToSkip).toBe(1);
      expect(secondaryWorkspaceRepeat.summary.knowledge?.claims.toCreate).toBe(0);
      expect(secondaryWorkspaceRepeat.summary.knowledge?.claims.toSkip).toBe(1);
      expect(secondaryWorkspaceRepeat.summary.knowledge?.evidence.toCreate).toBe(0);
      expect(secondaryWorkspaceRepeat.summary.knowledge?.evidence.toSkip).toBe(2);
      expect(secondaryWorkspaceRepeat.summary.knowledge?.attachments.toCreate).toBe(0);
      expect(secondaryWorkspaceRepeat.summary.knowledge?.attachments.toSkip).toBe(1);
      if (!secondaryWorkspaceRepeat.runId) {
        throw new Error("第二 Workspace 的重复 v2 预检未返回 runId。");
      }
      const secondaryWorkspaceRepeatResult = await confirmPortablePackageV2Import(
        secondaryWorkspaceRepeat.runId,
        sameActorSecondaryWorkspace,
      );
      expect(secondaryWorkspaceRepeatResult.result.recordsCreated).toBe(0);
      expect(secondaryWorkspaceRepeatResult.result.recordsSkipped).toBe(1);
      expect(secondaryWorkspaceRepeatResult.result.claimsCreated).toBe(0);
      expect(secondaryWorkspaceRepeatResult.result.claimsSkipped).toBe(1);
      expect(secondaryWorkspaceRepeatResult.result.evidenceCreated).toBe(0);
      expect(secondaryWorkspaceRepeatResult.result.evidenceSkipped).toBe(2);
      expect(secondaryWorkspaceRepeatResult.result.attachmentsCreated).toBe(0);
      expect(secondaryWorkspaceRepeatResult.result.attachmentsSkipped).toBe(1);

      const actorCaptureCounts = await targetSql`
        select created_by_id, count(*)::int as count
        from captures
        group by created_by_id
        order by created_by_id
      `;
      expect(actorCaptureCounts).toEqual([
        { created_by_id: "go-user:2002", count: 1 },
        { created_by_id: "local-owner", count: 2 },
      ]);

      const actorProvenanceCounts = await targetSql`
        select workspace_id::text as workspace_id, actor_id, count(*)::int as count
        from data_import_objects
        group by workspace_id, actor_id
        order by workspace_id, actor_id
      `;
      expect(actorProvenanceCounts).toEqual([
        { workspace_id: defaultWorkspaceId, actor_id: "go-user:2002", count: 4 },
        { workspace_id: defaultWorkspaceId, actor_id: "local-owner", count: 4 },
        { workspace_id: secondaryWorkspaceId, actor_id: "local-owner", count: 4 },
      ]);

      const finalCounts = await targetSql`
        select
          (select count(*)::int from captures) as captures,
          (select count(*)::int from claims) as claims,
          (select count(*)::int from claim_evidence) as evidence,
          (select count(*)::int from evidence_attachments) as attachments,
          (select count(*)::int from data_import_objects) as provenance
      `;
      expect(finalCounts[0]).toMatchObject({
        captures: 3,
        claims: 3,
        evidence: 6,
        attachments: 3,
        provenance: 12,
      });

      console.info(
        "[isolated-v2] PASS: empty-instance restore, trust downgrade, image SHA-256/HTTP, same-actor idempotency, and cross-actor provenance isolation verified.",
      );
    } finally {
      await sourceSql.end({ timeout: 2 });
      await targetSql.end({ timeout: 2 });
    }
  }, 30_000);

  it("keeps captures, categories, direct IDs, and idempotency isolated by Workspace", async () => {
    if (!(await isReady(TARGET_APP))) {
      console.warn(
        "[isolated-workspace] SKIP: start tests/isolated-v2/compose.yaml to run the real Workspace isolation test.",
      );
      return;
    }

    const targetSql = postgres(TARGET_DATABASE, { max: 1 });
    try {
      await resetDatabase(targetSql);
      await targetSql`
        insert into workspaces (
          id, name, slug, created_by_id, created_by_name
        ) values (
          ${secondaryWorkspaceId}, '第二隔离空间', 'isolated-secondary',
          'local-owner', '本地使用者'
        )
        on conflict (id) do update
        set name = excluded.name, slug = excluded.slug,
            created_by_id = excluded.created_by_id,
            created_by_name = excluded.created_by_name
      `;
      await targetSql`
        insert into workspace_memberships (
          workspace_id, actor_id, actor_name, role
        ) values (
          ${secondaryWorkspaceId}, 'local-owner', '本地使用者', 'owner'
        )
        on conflict (workspace_id, actor_id) do update
        set actor_name = excluded.actor_name, role = excluded.role
      `;

      const workspaceListResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`);
      const workspaceListBody = await workspaceListResponse.json();
      expect(workspaceListResponse.status, JSON.stringify(workspaceListBody)).toBe(200);
      expect(workspaceListBody.data.currentWorkspaceId).toBe(defaultWorkspaceId);
      expect(workspaceListBody.data.workspaces).toHaveLength(2);
      expect(
        workspaceListBody.data.workspaces.map((workspace: { workspaceId: string }) => workspace.workspaceId),
      ).toEqual(expect.arrayContaining([defaultWorkspaceId, secondaryWorkspaceId]));

      const createWorkspaceResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "API 创建空间" }),
      });
      const createWorkspaceBody = await createWorkspaceResponse.json();
      expect(createWorkspaceResponse.status, JSON.stringify(createWorkspaceBody)).toBe(201);
      const apiCreatedWorkspaceId = createWorkspaceBody.data.workspaceId as string;
      expect(createWorkspaceBody.data.role).toBe("owner");

      const switchWorkspaceResponse = await fetch(
        `${TARGET_APP}/api/v1/workspaces/current`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: apiCreatedWorkspaceId }),
        },
      );
      const switchWorkspaceBody = await switchWorkspaceResponse.json();
      expect(switchWorkspaceResponse.status, JSON.stringify(switchWorkspaceBody)).toBe(200);
      const setCookie = switchWorkspaceResponse.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`knowtrace_workspace_id=${apiCreatedWorkspaceId}`);
      expect(setCookie.toLowerCase()).toContain("httponly");
      expect(setCookie.toLowerCase()).toContain("samesite=lax");
      expect(setCookie.toLowerCase()).toContain("path=/");
      expect(setCookie.toLowerCase()).not.toContain("secure");
      const createdWorkspaceCookie = setCookie.split(";")[0]!;

      const selectedWorkspaceResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        headers: { cookie: createdWorkspaceCookie },
      });
      const selectedWorkspaceBody = await selectedWorkspaceResponse.json();
      expect(
        selectedWorkspaceResponse.status,
        JSON.stringify(selectedWorkspaceBody),
      ).toBe(200);
      expect(selectedWorkspaceBody.data.currentWorkspaceId).toBe(apiCreatedWorkspaceId);

      const protectedDefaultDeleteResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: defaultWorkspaceId,
          confirmationName: "默认空间",
        }),
      });
      const protectedDefaultDeleteBody = await protectedDefaultDeleteResponse.json();
      expect(protectedDefaultDeleteResponse.status).not.toBe(200);
      expect(protectedDefaultDeleteBody.error?.code).toBe(
        "WORKSPACE_DEFAULT_DELETE_FORBIDDEN",
      );

      const mismatchDeleteResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          cookie: createdWorkspaceCookie,
        },
        body: JSON.stringify({
          workspaceId: apiCreatedWorkspaceId,
          confirmationName: "错误名称",
        }),
      });
      const mismatchDeleteBody = await mismatchDeleteResponse.json();
      expect(mismatchDeleteResponse.status).not.toBe(200);
      expect(mismatchDeleteBody.error?.code).toBe(
        "WORKSPACE_DELETE_CONFIRMATION_MISMATCH",
      );

      const emptyDeleteResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          cookie: createdWorkspaceCookie,
        },
        body: JSON.stringify({
          workspaceId: apiCreatedWorkspaceId,
          confirmationName: "API 创建空间",
        }),
      });
      const emptyDeleteBody = await emptyDeleteResponse.json();
      expect(emptyDeleteResponse.status, JSON.stringify(emptyDeleteBody)).toBe(200);
      expect(emptyDeleteBody.data.deletedWorkspaceId).toBe(apiCreatedWorkspaceId);
      expect(emptyDeleteBody.data.currentWorkspaceId).toBe(defaultWorkspaceId);
      const deleteSetCookie = emptyDeleteResponse.headers.get("set-cookie") ?? "";
      expect(deleteSetCookie).toContain(`knowtrace_workspace_id=${defaultWorkspaceId}`);
      expect(deleteSetCookie.toLowerCase()).toContain("httponly");
      const deletedWorkspaceRows = await targetSql`
        select id from workspaces where id = ${apiCreatedWorkspaceId}
      `;
      expect(deletedWorkspaceRows).toHaveLength(0);

      await targetSql`
        insert into workspaces (
          id, name, slug, created_by_id, created_by_name
        ) values (
          ${memberWorkspaceId}, '成员权限空间', 'isolated-member-role',
          'go-user:9999', '其他所有者'
        )
      `;
      await targetSql`
        insert into workspace_memberships (
          workspace_id, actor_id, actor_name, role
        ) values (
          ${memberWorkspaceId}, 'local-owner', '本地使用者', 'member'
        )
      `;
      const memberDeleteResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          cookie: `knowtrace_workspace_id=${memberWorkspaceId}`,
        },
        body: JSON.stringify({
          workspaceId: memberWorkspaceId,
          confirmationName: "成员权限空间",
        }),
      });
      const memberDeleteBody = await memberDeleteResponse.json();
      expect(memberDeleteResponse.status).not.toBe(200);
      expect(memberDeleteBody.error?.code).toBe("WORKSPACE_DELETE_FORBIDDEN");
      const preservedMemberWorkspace = await targetSql`
        select id from workspaces where id = ${memberWorkspaceId}
      `;
      expect(preservedMemberWorkspace).toHaveLength(1);

      const deniedWorkspaceResponse = await fetch(
        `${TARGET_APP}/api/v1/workspaces/current`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          }),
        },
      );
      expect(deniedWorkspaceResponse.status).not.toBe(200);
      expect(deniedWorkspaceResponse.headers.get("set-cookie")).toBeNull();

      const createCaptureInWorkspace = async (workspaceId: string, title: string) => {
        const response = await fetch(`${TARGET_APP}/api/v1/captures`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "workspace-shared-key-01",
            cookie: `knowtrace_workspace_id=${workspaceId}`,
          },
          body: JSON.stringify({
            title,
            subject: "Workspace isolation",
            content: `${title} content`,
            occurredAt: "2026-08-28T05:00:00.000Z",
            contentType: "observation",
            categoryIds: [],
          }),
        });
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(201);
        return body.data.id as string;
      };

      const defaultCaptureId = await createCaptureInWorkspace(
        defaultWorkspaceId,
        "默认空间记录",
      );
      const secondaryCaptureId = await createCaptureInWorkspace(
        secondaryWorkspaceId,
        "第二空间记录",
      );
      expect(secondaryCaptureId).not.toBe(defaultCaptureId);

      await targetSql`
        insert into claims (
          capture_id, source_suggestion_id, source_capture_version,
          statement, statement_hash, source_excerpt, falsification_criteria,
          status
        ) values
        (
          ${defaultCaptureId}, null, 1,
          '默认空间主张', ${hash("workspace-default-claim")},
          '默认空间记录 content', '默认空间证伪条件', 'candidate'
        ),
        (
          ${secondaryCaptureId}, null, 1,
          '第二空间主张', ${hash("workspace-secondary-claim")},
          '第二空间记录 content', '第二空间证伪条件', 'candidate'
        )
      `;

      await targetSql`
        insert into categories (
          id, workspace_id, name, normalized_name, description, status,
          created_by_id, created_by_name
        ) values
        (
          ${defaultWorkspaceCategoryId}, ${defaultWorkspaceId},
          '同名分类', '同名分类', 'default workspace category', 'active',
          'local-owner', '本地使用者'
        ),
        (
          ${secondaryWorkspaceCategoryId}, ${secondaryWorkspaceId},
          '同名分类', '同名分类', 'secondary workspace category', 'active',
          'local-owner', '本地使用者'
        )
      `;

      const defaultListResponse = await fetch(`${TARGET_APP}/api/v1/captures`);
      const defaultListBody = await defaultListResponse.json();
      expect(defaultListResponse.status, JSON.stringify(defaultListBody)).toBe(200);
      expect(defaultListBody.data).toHaveLength(1);
      expect(defaultListBody.data[0]?.id).toBe(defaultCaptureId);

      const secondaryListResponse = await fetch(`${TARGET_APP}/api/v1/captures`, {
        headers: { cookie: `knowtrace_workspace_id=${secondaryWorkspaceId}` },
      });
      const secondaryListBody = await secondaryListResponse.json();
      expect(secondaryListResponse.status, JSON.stringify(secondaryListBody)).toBe(200);
      expect(secondaryListBody.data).toHaveLength(1);
      expect(secondaryListBody.data[0]?.id).toBe(secondaryCaptureId);

      const crossWorkspaceDetailResponse = await fetch(
        `${TARGET_APP}/api/v1/captures/${defaultCaptureId}`,
        { headers: { cookie: `knowtrace_workspace_id=${secondaryWorkspaceId}` } },
      );
      expect(crossWorkspaceDetailResponse.status).toBe(404);

      const secondaryCategoriesResponse = await fetch(`${TARGET_APP}/api/v1/categories`, {
        headers: { cookie: `knowtrace_workspace_id=${secondaryWorkspaceId}` },
      });
      const secondaryCategoriesBody = await secondaryCategoriesResponse.json();
      expect(
        secondaryCategoriesResponse.status,
        JSON.stringify(secondaryCategoriesBody),
      ).toBe(200);
      expect(secondaryCategoriesBody.data).toHaveLength(1);
      expect(secondaryCategoriesBody.data[0]?.id).toBe(secondaryWorkspaceCategoryId);

      const defaultClaimsResponse = await fetch(`${TARGET_APP}/api/v1/claims`);
      const defaultClaimsBody = await defaultClaimsResponse.json();
      expect(defaultClaimsResponse.status, JSON.stringify(defaultClaimsBody)).toBe(200);
      expect(defaultClaimsBody.data).toHaveLength(1);
      expect(defaultClaimsBody.data[0]?.captureId).toBe(defaultCaptureId);
      expect(defaultClaimsBody.data[0]?.statement).toBe("默认空间主张");

      const secondaryClaimsResponse = await fetch(`${TARGET_APP}/api/v1/claims`, {
        headers: { cookie: `knowtrace_workspace_id=${secondaryWorkspaceId}` },
      });
      const secondaryClaimsBody = await secondaryClaimsResponse.json();
      expect(secondaryClaimsResponse.status, JSON.stringify(secondaryClaimsBody)).toBe(200);
      expect(secondaryClaimsBody.data).toHaveLength(1);
      expect(secondaryClaimsBody.data[0]?.captureId).toBe(secondaryCaptureId);
      expect(secondaryClaimsBody.data[0]?.statement).toBe("第二空间主张");

      const defaultSubjectsResponse = await fetch(`${TARGET_APP}/api/v1/subjects`);
      const defaultSubjectsBody = await defaultSubjectsResponse.json();
      expect(defaultSubjectsResponse.status, JSON.stringify(defaultSubjectsBody)).toBe(200);
      expect(defaultSubjectsBody.data).toHaveLength(1);
      expect(defaultSubjectsBody.data[0]?.name).toBe("Workspace isolation");
      expect(defaultSubjectsBody.data[0]?.captureCount).toBe(1);

      const secondarySubjectsResponse = await fetch(`${TARGET_APP}/api/v1/subjects`, {
        headers: { cookie: `knowtrace_workspace_id=${secondaryWorkspaceId}` },
      });
      const secondarySubjectsBody = await secondarySubjectsResponse.json();
      expect(secondarySubjectsResponse.status, JSON.stringify(secondarySubjectsBody)).toBe(200);
      expect(secondarySubjectsBody.data).toHaveLength(1);
      expect(secondarySubjectsBody.data[0]?.name).toBe("Workspace isolation");
      expect(secondarySubjectsBody.data[0]?.captureCount).toBe(1);

      const defaultSearchResponse = await fetch(
        `${TARGET_APP}/search?q=${encodeURIComponent("空间记录")}&from=2026-08-28&to=2026-08-28`,
      );
      const defaultSearchHtml = await defaultSearchResponse.text();
      expect(defaultSearchResponse.status).toBe(200);
      expect(defaultSearchHtml).toContain("默认空间记录");
      expect(defaultSearchHtml).not.toContain("第二空间记录");

      const secondarySearchResponse = await fetch(
        `${TARGET_APP}/search?q=${encodeURIComponent("空间记录")}&from=2026-08-28&to=2026-08-28`,
        { headers: { cookie: `knowtrace_workspace_id=${secondaryWorkspaceId}` } },
      );
      const secondarySearchHtml = await secondarySearchResponse.text();
      expect(secondarySearchResponse.status).toBe(200);
      expect(secondarySearchHtml).toContain("第二空间记录");
      expect(secondarySearchHtml).not.toContain("默认空间记录");

      const invalidWorkspaceResponse = await fetch(`${TARGET_APP}/api/v1/captures`, {
        headers: {
          cookie:
            "knowtrace_workspace_id=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        },
      });
      const invalidWorkspaceBody = await invalidWorkspaceResponse.json();
      expect(invalidWorkspaceResponse.status, JSON.stringify(invalidWorkspaceBody)).toBe(200);
      expect(invalidWorkspaceBody.data).toHaveLength(1);
      expect(invalidWorkspaceBody.data[0]?.id).toBe(defaultCaptureId);

      const duplicateKeyRows = await targetSql`
        select workspace_id, count(*)::int as count
        from captures
        where created_by_id = 'local-owner'
          and idempotency_key = 'workspace-shared-key-01'
        group by workspace_id
        order by workspace_id
      `;
      expect(duplicateKeyRows).toHaveLength(2);
      expect(duplicateKeyRows.every((row) => row.count === 1)).toBe(true);

      const nonEmptyDeleteResponse = await fetch(`${TARGET_APP}/api/v1/workspaces`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          cookie: `knowtrace_workspace_id=${secondaryWorkspaceId}`,
        },
        body: JSON.stringify({
          workspaceId: secondaryWorkspaceId,
          confirmationName: "第二隔离空间",
        }),
      });
      const nonEmptyDeleteBody = await nonEmptyDeleteResponse.json();
      expect(nonEmptyDeleteResponse.status).not.toBe(200);
      expect(nonEmptyDeleteBody.error?.code).toBe("WORKSPACE_NOT_EMPTY");
      const preservedSecondaryWorkspace = await targetSql`
        select id from workspaces where id = ${secondaryWorkspaceId}
      `;
      expect(preservedSecondaryWorkspace).toHaveLength(1);

      console.info(
        "[isolated-workspace] PASS: list/detail/category/idempotency boundaries stay inside the selected Workspace.",
      );
    } finally {
      await targetSql.end({ timeout: 2 });
    }
  }, 30_000);
});
