import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
} from "./contracts-v2";
import {
  createPortableWorkbookV2,
  parsePortableWorkbookV2,
} from "./workbook-v2";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

const payload: PortablePayloadV2 = {
  formatVersion: "2",
  trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
  records: [
    {
      key: "record-001",
      title: "一次观察",
      content: "某产品在测试环境出现了异常行为。",
      contentType: "observation",
      subject: "KnowTrace",
      occurredAt: "2026-08-23T02:30:00.000Z",
      status: "active",
      categoryKeys: ["category-001"],
    },
  ],
  categories: [
    {
      key: "category-001",
      name: "案例",
      description: "测试分类",
      status: "active",
    },
  ],
  claims: [
    {
      key: "claim-001",
      recordKey: "record-001",
      sourceCaptureVersion: 3,
      statement: "该异常可以稳定复现。",
      sourceExcerpt: "某产品在测试环境出现了异常行为。",
      falsificationCriteria: "在相同环境连续十次均无法复现。",
      originalStatus: "concluded",
    },
  ],
  evidence: [
    {
      key: "evidence-web",
      claimKey: "claim-001",
      sourceUrl: "https://example.com/report",
      sourceTitle: "测试报告",
      excerpt: "连续三次测试均复现。",
      stance: "supports",
      note: "公开来源",
      version: 2,
      originalReviewStatus: "accepted",
      originalSourceCheckStatus: "passed",
      originalSourceExcerptMatch: true,
      latestCheckKey: "check-web",
    },
    {
      key: "evidence-image",
      claimKey: "claim-001",
      sourceUrl: "",
      sourceTitle: "现场截图",
      excerpt: "截图显示异常状态。",
      stance: "supports",
      note: null,
      version: 1,
      originalReviewStatus: "accepted",
      originalSourceCheckStatus: "passed",
      originalSourceExcerptMatch: true,
      latestCheckKey: "check-image",
    },
  ],
  sourceChecks: [
    {
      key: "check-web",
      evidenceKey: "evidence-web",
      evidenceVersion: 2,
      requestedUrl: "https://example.com/report",
      finalUrl: "https://example.com/report",
      status: "passed",
      httpStatus: 200,
      contentType: "text/html",
      contentHash: hashA,
      fetchedTitle: "测试报告",
      excerptMatch: true,
      responseBytes: 4096,
      errorCode: null,
      checkedAt: "2026-08-23T03:00:00.000Z",
    },
  ],
  attachmentChecks: [
    {
      key: "check-image",
      evidenceKey: "evidence-image",
      evidenceVersion: 1,
      contentHash: hashB,
      responseBytes: 1024,
      verificationNote: "已查看图片并确认摘录与附件一致。",
      checkedAt: "2026-08-23T03:10:00.000Z",
    },
  ],
  attachmentCheckImages: [
    { checkKey: "check-image", attachmentKey: "attachment-001" },
  ],
  reviews: [
    {
      key: "review-001",
      claimKey: "claim-001",
      reviewNumber: 1,
      assessment: "supported",
      rationale: "公开报告和现场截图均支持该主张。",
      limitations: "样本量仍较小。",
      reviewerId: "user-001",
      reviewerName: "审核者",
      createdAt: "2026-08-23T04:00:00.000Z",
    },
  ],
  reviewEvidence: [
    {
      reviewKey: "review-001",
      evidenceKey: "evidence-web",
      checkKey: "check-web",
      stance: "supports",
      sourceUrl: "https://example.com/report",
      sourceTitle: "测试报告",
      excerpt: "连续三次测试均复现。",
      finalUrl: "https://example.com/report",
      sourceContentHash: hashA,
      sourceCheckedAt: "2026-08-23T03:00:00.000Z",
    },
    {
      reviewKey: "review-001",
      evidenceKey: "evidence-image",
      checkKey: "check-image",
      stance: "supports",
      sourceUrl: "",
      sourceTitle: "现场截图",
      excerpt: "截图显示异常状态。",
      finalUrl: "/api/evidence-images/attachment-001",
      sourceContentHash: hashB,
      sourceCheckedAt: "2026-08-23T03:10:00.000Z",
    },
  ],
  attachments: [
    {
      key: "attachment-001",
      evidenceKey: "evidence-image",
      relativePath: "attachments/evidence-image/attachment-001.png",
      originalName: "现场截图.png",
      mimeType: "image/png",
      byteSize: 1024,
      sha256: hashC,
    },
  ],
};

describe("KnowTrace portable workbook v2", () => {
  it("round-trips the claim and evidence chain while declaring untrusted downgrade policy", async () => {
    const buffer = await createPortableWorkbookV2(payload);
    const parsed = await parsePortableWorkbookV2(buffer);

    expect(parsed.issues).toEqual([]);
    expect(parsed.payload).toEqual(payload);
  });

  it("rejects formulas in v2 knowledge-chain cells", async () => {
    const source = await createPortableWorkbookV2(payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(source).buffer);
    workbook.getWorksheet("证据")!.getCell("E2").value = {
      formula: 'HYPERLINK("https://example.com")',
      result: "伪造摘录",
    };
    const modified = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parsePortableWorkbookV2(modified);

    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        sheet: "证据",
        row: 2,
        field: "证据摘录",
        message: "数据单元格不能使用公式",
      }),
    );
  });

  it("reports broken stable references before any database import", async () => {
    const source = await createPortableWorkbookV2(payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(source).buffer);
    workbook.getWorksheet("主张")!.getCell("B2").value = "missing-record";
    const modified = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parsePortableWorkbookV2(modified);

    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        sheet: "主张",
        row: 2,
        field: "记录标识",
        message: expect.stringContaining("missing-record"),
      }),
    );
  });

  it("rejects attachment path traversal at the contract boundary", async () => {
    await expect(
      createPortableWorkbookV2({
        ...payload,
        attachments: [
          {
            ...payload.attachments[0]!,
            relativePath: "../escape.png",
          },
        ],
      }),
    ).rejects.toThrow(/目录穿越/);
  });
});
