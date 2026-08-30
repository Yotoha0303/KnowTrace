import ExcelJS, { type Cell, type Worksheet } from "exceljs";
import { z } from "zod";

import { type ImportIssue } from "./contracts";
import {
  DATA_TRANSFER_V2_FORMAT_VERSION,
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
  portableAttachmentCheckImageV2Schema,
  portableAttachmentCheckV2Schema,
  portableAttachmentManifestEntryV2Schema,
  portableClaimReviewEvidenceV2Schema,
  portableClaimReviewV2Schema,
  portableClaimV2Schema,
  portableEvidenceV2Schema,
  portablePayloadV2Schema,
  portableWebSourceCheckV2Schema,
} from "./contracts-v2";
import { createPortableWorkbook, parsePortableWorkbook } from "./workbook";

const SHEETS = {
  instructions: "使用说明",
  metadata: "元数据",
  claims: "主张",
  evidence: "证据",
  sourceChecks: "来源检查",
  attachmentChecks: "附件检查",
  attachmentCheckImages: "附件检查图片",
  reviews: "人工结论",
  reviewEvidence: "结论证据",
  attachments: "图片清单",
} as const;

const CLAIM_HEADERS = [
  "主张标识",
  "记录标识",
  "来源记录版本",
  "主张陈述",
  "来源摘录",
  "证伪条件",
  "原状态",
] as const;

const EVIDENCE_HEADERS = [
  "证据标识",
  "主张标识",
  "来源标题",
  "来源URL",
  "证据摘录",
  "立场",
  "备注",
  "版本",
  "原审核状态",
  "原来源检查状态",
  "原摘录匹配",
  "最新检查标识",
] as const;

const SOURCE_CHECK_HEADERS = [
  "核验标识",
  "证据标识",
  "证据版本",
  "请求URL",
  "最终URL",
  "状态",
  "HTTP状态",
  "内容类型",
  "内容哈希",
  "抓取标题",
  "摘录匹配",
  "响应字节",
  "错误码",
  "核验时间",
] as const;

const ATTACHMENT_CHECK_HEADERS = [
  "核验标识",
  "证据标识",
  "证据版本",
  "内容哈希",
  "响应字节",
  "核验说明",
  "核验时间",
] as const;

const ATTACHMENT_CHECK_IMAGE_HEADERS = ["核验标识", "图片标识"] as const;

const REVIEW_HEADERS = [
  "结论标识",
  "主张标识",
  "结论序号",
  "判断",
  "判断依据",
  "局限",
  "审核者标识",
  "审核者名称",
  "形成时间",
] as const;

const REVIEW_EVIDENCE_HEADERS = [
  "结论标识",
  "证据标识",
  "核验标识",
  "立场",
  "来源URL",
  "来源标题",
  "摘录",
  "最终URL",
  "来源内容哈希",
  "来源核验时间",
] as const;

const ATTACHMENT_HEADERS = [
  "图片标识",
  "证据标识",
  "相对路径",
  "原文件名",
  "MIME",
  "字节数",
  "SHA256",
] as const;

const headerFill = "1A2B23";
const lineColor = "D9DED7";

type ParsedRow<T> = { data: T; row: number };

function styleDataSheet(sheet: Worksheet, widths: number[]) {
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.autoFilter = {
    from: "A1",
    to: sheet.getRow(1).getCell(widths.length).address,
  };
  sheet.columns.forEach((column, index) => {
    column.width = widths[index];
    column.alignment = { vertical: "top", wrapText: true };
  });
  const header = sheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${headerFill}` },
  };
  header.alignment = { vertical: "middle", horizontal: "left" };
  header.eachCell((cell) => {
    cell.border = {
      bottom: { style: "thin", color: { argb: `FF${lineColor}` } },
    };
  });
}

function addDataSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: readonly string[],
  widths: number[],
  rows: Array<Array<string | number | boolean | Date | null>>,
) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  sheet.addRows(rows);
  styleDataSheet(sheet, widths);
  return sheet;
}

function isFormula(cell: Cell): boolean {
  return Boolean(
    cell.value && typeof cell.value === "object" && "formula" in cell.value,
  );
}

function cellText(cell: Cell): string {
  if (cell.value instanceof Date) return cell.value.toISOString();
  return cell.text.trim();
}

function nullableCellText(cell: Cell): string | null {
  const value = cellText(cell);
  return value.length ? value : null;
}

function integerCellValue(cell: Cell): unknown {
  if (typeof cell.value === "number" && Number.isInteger(cell.value)) {
    return cell.value;
  }
  const text = cellText(cell);
  if (!text.length) return Number.NaN;
  const value = Number(text);
  return Number.isInteger(value) ? value : Number.NaN;
}

function nullableIntegerCellValue(cell: Cell): unknown {
  if (!cellText(cell).length) return null;
  return integerCellValue(cell);
}

function nullableBooleanCellValue(cell: Cell): unknown {
  if (typeof cell.value === "boolean") return cell.value;
  const text = cellText(cell).toLowerCase();
  if (!text.length) return null;
  if (["true", "1", "yes"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  return text;
}

function dateTimeCellValue(cell: Cell): string {
  if (cell.value instanceof Date) return cell.value.toISOString();
  const text = cellText(cell);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function validateHeaders(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  headers: readonly string[],
  issues: ImportIssue[],
): Worksheet | null {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    issues.push({
      sheet: "工作簿",
      row: 0,
      field: "工作表",
      message: `缺少“${sheetName}”工作表`,
    });
    return null;
  }
  headers.forEach((header, index) => {
    if (cellText(sheet.getRow(1).getCell(index + 1)) !== header) {
      issues.push({
        sheet: sheetName,
        row: 1,
        field: header,
        message: `第 ${index + 1} 列表头必须是“${header}”`,
      });
    }
  });
  return sheet;
}

function parseRows<T>(input: {
  workbook: ExcelJS.Workbook;
  sheetName: string;
  headers: readonly string[];
  schema: z.ZodType<T>;
  issues: ImportIssue[];
  map: (cells: Cell[]) => unknown;
}): ParsedRow<T>[] {
  const sheet = validateHeaders(
    input.workbook,
    input.sheetName,
    input.headers,
    input.issues,
  );
  if (!sheet) return [];

  const rows: ParsedRow<T>[] = [];
  for (let row = 2; row <= sheet.actualRowCount; row += 1) {
    const cells = input.headers.map((_, index) =>
      sheet.getRow(row).getCell(index + 1),
    );
    if (cells.every((cell) => cellText(cell) === "")) continue;
    cells.forEach((cell, index) => {
      if (isFormula(cell)) {
        input.issues.push({
          sheet: input.sheetName,
          row,
          field: input.headers[index]!,
          message: "数据单元格不能使用公式",
        });
      }
    });
    const parsed = input.schema.safeParse(input.map(cells));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        input.issues.push({
          sheet: input.sheetName,
          row,
          field: String(issue.path[0] ?? "行"),
          message: issue.message,
        });
      }
      continue;
    }
    rows.push({ data: parsed.data, row });
  }
  return rows;
}

function uniqueKeyMap<T>(input: {
  rows: ParsedRow<T>[];
  key: (value: T) => string;
  sheet: string;
  field: string;
  issues: ImportIssue[];
}): Map<string, ParsedRow<T>> {
  const result = new Map<string, ParsedRow<T>>();
  for (const row of input.rows) {
    const key = input.key(row.data);
    if (result.has(key)) {
      input.issues.push({
        sheet: input.sheet,
        row: row.row,
        field: input.field,
        message: `${input.field}重复`,
      });
    } else {
      result.set(key, row);
    }
  }
  return result;
}

function checkReference(
  issues: ImportIssue[],
  input: {
    sheet: string;
    row: number;
    field: string;
    key: string;
    target: Set<string>;
    targetName: string;
  },
) {
  if (!input.target.has(input.key)) {
    issues.push({
      sheet: input.sheet,
      row: input.row,
      field: input.field,
      message: `找不到对应${input.targetName}“${input.key}”`,
    });
  }
}

export async function createPortableWorkbookV2(
  payload: PortablePayloadV2,
): Promise<Buffer> {
  const parsed = portablePayloadV2Schema.parse(payload);
  const v1 = await createPortableWorkbook({
    formatVersion: "1",
    records: parsed.records,
    categories: parsed.categories,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(v1).buffer);

  const metadata = workbook.getWorksheet(SHEETS.metadata)!;
  metadata.getCell("B1").value = DATA_TRANSFER_V2_FORMAT_VERSION;
  metadata.addRow(["trust_policy", DATA_TRANSFER_V2_TRUST_POLICY]);

  const instructions = workbook.getWorksheet(SHEETS.instructions)!;
  instructions.getCell("B2").value = DATA_TRANSFER_V2_FORMAT_VERSION;
  instructions.getCell("B3").value =
    "记录、分类、主张、证据、来源检查、附件检查、人工结论、结论证据关系和图片清单。";
  instructions.getCell("B4").value =
    "AI 处理历史、独立复核、来源权威性评估和可靠知识发布版本仍不包含在普通 v2 交换包中。";
  instructions.addRow([
    "可信状态策略",
    "v2 Excel 是可编辑的非受信任交换格式。导出的已采纳、已核验、已结论状态只用于迁移上下文；导入写库时必须安全降级并重新核验，不能仅凭 Excel 恢复可信状态。",
  ]);

  addDataSheet(
    workbook,
    SHEETS.claims,
    CLAIM_HEADERS,
    [40, 40, 16, 62, 62, 62, 18],
    parsed.claims.map((claim) => [
      claim.key,
      claim.recordKey,
      claim.sourceCaptureVersion,
      claim.statement,
      claim.sourceExcerpt,
      claim.falsificationCriteria,
      claim.originalStatus,
    ]),
  );

  addDataSheet(
    workbook,
    SHEETS.evidence,
    EVIDENCE_HEADERS,
    [40, 40, 42, 58, 70, 18, 50, 12, 18, 20, 16, 40],
    parsed.evidence.map((evidence) => [
      evidence.key,
      evidence.claimKey,
      evidence.sourceTitle,
      evidence.sourceUrl,
      evidence.excerpt,
      evidence.stance,
      evidence.note,
      evidence.version,
      evidence.originalReviewStatus,
      evidence.originalSourceCheckStatus,
      evidence.originalSourceExcerptMatch,
      evidence.latestCheckKey,
    ]),
  );

  addDataSheet(
    workbook,
    SHEETS.sourceChecks,
    SOURCE_CHECK_HEADERS,
    [40, 40, 16, 58, 58, 14, 14, 28, 68, 38, 16, 16, 22, 25],
    parsed.sourceChecks.map((check) => [
      check.key,
      check.evidenceKey,
      check.evidenceVersion,
      check.requestedUrl,
      check.finalUrl,
      check.status,
      check.httpStatus,
      check.contentType,
      check.contentHash,
      check.fetchedTitle,
      check.excerptMatch,
      check.responseBytes,
      check.errorCode,
      new Date(check.checkedAt),
    ]),
  );

  addDataSheet(
    workbook,
    SHEETS.attachmentChecks,
    ATTACHMENT_CHECK_HEADERS,
    [40, 40, 16, 68, 16, 72, 25],
    parsed.attachmentChecks.map((check) => [
      check.key,
      check.evidenceKey,
      check.evidenceVersion,
      check.contentHash,
      check.responseBytes,
      check.verificationNote,
      new Date(check.checkedAt),
    ]),
  );

  addDataSheet(
    workbook,
    SHEETS.attachmentCheckImages,
    ATTACHMENT_CHECK_IMAGE_HEADERS,
    [40, 40],
    parsed.attachmentCheckImages.map((relationship) => [
      relationship.checkKey,
      relationship.attachmentKey,
    ]),
  );

  addDataSheet(
    workbook,
    SHEETS.reviews,
    REVIEW_HEADERS,
    [40, 40, 14, 18, 72, 60, 34, 34, 25],
    parsed.reviews.map((review) => [
      review.key,
      review.claimKey,
      review.reviewNumber,
      review.assessment,
      review.rationale,
      review.limitations,
      review.reviewerId,
      review.reviewerName,
      new Date(review.createdAt),
    ]),
  );

  addDataSheet(
    workbook,
    SHEETS.reviewEvidence,
    REVIEW_EVIDENCE_HEADERS,
    [40, 40, 40, 18, 58, 42, 70, 58, 68, 25],
    parsed.reviewEvidence.map((relationship) => [
      relationship.reviewKey,
      relationship.evidenceKey,
      relationship.checkKey,
      relationship.stance,
      relationship.sourceUrl,
      relationship.sourceTitle,
      relationship.excerpt,
      relationship.finalUrl,
      relationship.sourceContentHash,
      new Date(relationship.sourceCheckedAt),
    ]),
  );

  addDataSheet(
    workbook,
    SHEETS.attachments,
    ATTACHMENT_HEADERS,
    [40, 40, 58, 42, 24, 16, 68],
    parsed.attachments.map((attachment) => [
      attachment.key,
      attachment.evidenceKey,
      attachment.relativePath,
      attachment.originalName,
      attachment.mimeType,
      attachment.byteSize,
      attachment.sha256,
    ]),
  );

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parsePortableWorkbookV2(
  buffer: Buffer,
): Promise<{ payload: PortablePayloadV2; issues: ImportIssue[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  const issues: ImportIssue[] = [];
  const metadata = workbook.getWorksheet(SHEETS.metadata);
  const formatVersion = metadata ? cellText(metadata.getCell("B1")) : "";
  const trustPolicy = metadata ? cellText(metadata.getCell("B3")) : "";

  if (formatVersion !== DATA_TRANSFER_V2_FORMAT_VERSION) {
    issues.push({
      sheet: SHEETS.metadata,
      row: 1,
      field: "format_version",
      message: `仅支持格式版本 ${DATA_TRANSFER_V2_FORMAT_VERSION}`,
    });
  }
  if (trustPolicy !== DATA_TRANSFER_V2_TRUST_POLICY) {
    issues.push({
      sheet: SHEETS.metadata,
      row: 3,
      field: "trust_policy",
      message: `v2 交换包必须声明 ${DATA_TRANSFER_V2_TRUST_POLICY}`,
    });
  }

  let basePayload: Awaited<ReturnType<typeof parsePortableWorkbook>>["payload"] = {
    formatVersion: "1",
    records: [],
    categories: [],
  };
  if (metadata) {
    const original = metadata.getCell("B1").value;
    metadata.getCell("B1").value = "1";
    const baseBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    metadata.getCell("B1").value = original;
    const base = await parsePortableWorkbook(baseBuffer);
    basePayload = base.payload;
    issues.push(...base.issues);
  } else {
    issues.push({
      sheet: "工作簿",
      row: 0,
      field: "工作表",
      message: `缺少“${SHEETS.metadata}”工作表`,
    });
  }

  const claimRows = parseRows({
    workbook,
    sheetName: SHEETS.claims,
    headers: CLAIM_HEADERS,
    schema: portableClaimV2Schema,
    issues,
    map: (cells) => ({
      key: cellText(cells[0]!),
      recordKey: cellText(cells[1]!),
      sourceCaptureVersion: integerCellValue(cells[2]!),
      statement: cellText(cells[3]!),
      sourceExcerpt: cellText(cells[4]!),
      falsificationCriteria: cellText(cells[5]!),
      originalStatus: cellText(cells[6]!),
    }),
  });

  const evidenceRows = parseRows({
    workbook,
    sheetName: SHEETS.evidence,
    headers: EVIDENCE_HEADERS,
    schema: portableEvidenceV2Schema,
    issues,
    map: (cells) => ({
      key: cellText(cells[0]!),
      claimKey: cellText(cells[1]!),
      sourceTitle: cellText(cells[2]!),
      sourceUrl: cellText(cells[3]!),
      excerpt: cellText(cells[4]!),
      stance: cellText(cells[5]!),
      note: nullableCellText(cells[6]!),
      version: integerCellValue(cells[7]!),
      originalReviewStatus: cellText(cells[8]!),
      originalSourceCheckStatus: cellText(cells[9]!),
      originalSourceExcerptMatch: nullableBooleanCellValue(cells[10]!),
      latestCheckKey: nullableCellText(cells[11]!),
    }),
  });

  const sourceCheckRows = parseRows({
    workbook,
    sheetName: SHEETS.sourceChecks,
    headers: SOURCE_CHECK_HEADERS,
    schema: portableWebSourceCheckV2Schema,
    issues,
    map: (cells) => ({
      key: cellText(cells[0]!),
      evidenceKey: cellText(cells[1]!),
      evidenceVersion: nullableIntegerCellValue(cells[2]!),
      requestedUrl: cellText(cells[3]!),
      finalUrl: nullableCellText(cells[4]!),
      status: cellText(cells[5]!),
      httpStatus: nullableIntegerCellValue(cells[6]!),
      contentType: nullableCellText(cells[7]!),
      contentHash: nullableCellText(cells[8]!),
      fetchedTitle: nullableCellText(cells[9]!),
      excerptMatch: nullableBooleanCellValue(cells[10]!),
      responseBytes: nullableIntegerCellValue(cells[11]!),
      errorCode: nullableCellText(cells[12]!),
      checkedAt: dateTimeCellValue(cells[13]!),
    }),
  });

  const attachmentCheckRows = parseRows({
    workbook,
    sheetName: SHEETS.attachmentChecks,
    headers: ATTACHMENT_CHECK_HEADERS,
    schema: portableAttachmentCheckV2Schema,
    issues,
    map: (cells) => ({
      key: cellText(cells[0]!),
      evidenceKey: cellText(cells[1]!),
      evidenceVersion: nullableIntegerCellValue(cells[2]!),
      contentHash: cellText(cells[3]!),
      responseBytes: integerCellValue(cells[4]!),
      verificationNote: cellText(cells[5]!),
      checkedAt: dateTimeCellValue(cells[6]!),
    }),
  });

  const attachmentCheckImageRows = parseRows({
    workbook,
    sheetName: SHEETS.attachmentCheckImages,
    headers: ATTACHMENT_CHECK_IMAGE_HEADERS,
    schema: portableAttachmentCheckImageV2Schema,
    issues,
    map: (cells) => ({
      checkKey: cellText(cells[0]!),
      attachmentKey: cellText(cells[1]!),
    }),
  });

  const reviewRows = parseRows({
    workbook,
    sheetName: SHEETS.reviews,
    headers: REVIEW_HEADERS,
    schema: portableClaimReviewV2Schema,
    issues,
    map: (cells) => ({
      key: cellText(cells[0]!),
      claimKey: cellText(cells[1]!),
      reviewNumber: integerCellValue(cells[2]!),
      assessment: cellText(cells[3]!),
      rationale: cellText(cells[4]!),
      limitations: nullableCellText(cells[5]!),
      reviewerId: cellText(cells[6]!),
      reviewerName: cellText(cells[7]!),
      createdAt: dateTimeCellValue(cells[8]!),
    }),
  });

  const reviewEvidenceRows = parseRows({
    workbook,
    sheetName: SHEETS.reviewEvidence,
    headers: REVIEW_EVIDENCE_HEADERS,
    schema: portableClaimReviewEvidenceV2Schema,
    issues,
    map: (cells) => ({
      reviewKey: cellText(cells[0]!),
      evidenceKey: cellText(cells[1]!),
      checkKey: cellText(cells[2]!),
      stance: cellText(cells[3]!),
      sourceUrl: cellText(cells[4]!),
      sourceTitle: cellText(cells[5]!),
      excerpt: cellText(cells[6]!),
      finalUrl: cellText(cells[7]!),
      sourceContentHash: cellText(cells[8]!),
      sourceCheckedAt: dateTimeCellValue(cells[9]!),
    }),
  });

  const attachmentRows = parseRows({
    workbook,
    sheetName: SHEETS.attachments,
    headers: ATTACHMENT_HEADERS,
    schema: portableAttachmentManifestEntryV2Schema,
    issues,
    map: (cells) => ({
      key: cellText(cells[0]!),
      evidenceKey: cellText(cells[1]!),
      relativePath: cellText(cells[2]!),
      originalName: cellText(cells[3]!),
      mimeType: cellText(cells[4]!),
      byteSize: integerCellValue(cells[5]!),
      sha256: cellText(cells[6]!),
    }),
  });

  const claimByKey = uniqueKeyMap({
    rows: claimRows,
    key: (claim) => claim.key,
    sheet: SHEETS.claims,
    field: "主张标识",
    issues,
  });
  const evidenceByKey = uniqueKeyMap({
    rows: evidenceRows,
    key: (evidence) => evidence.key,
    sheet: SHEETS.evidence,
    field: "证据标识",
    issues,
  });
  const sourceCheckByKey = uniqueKeyMap({
    rows: sourceCheckRows,
    key: (check) => check.key,
    sheet: SHEETS.sourceChecks,
    field: "核验标识",
    issues,
  });
  const attachmentCheckByKey = uniqueKeyMap({
    rows: attachmentCheckRows,
    key: (check) => check.key,
    sheet: SHEETS.attachmentChecks,
    field: "核验标识",
    issues,
  });
  const reviewByKey = uniqueKeyMap({
    rows: reviewRows,
    key: (review) => review.key,
    sheet: SHEETS.reviews,
    field: "结论标识",
    issues,
  });
  const attachmentByKey = uniqueKeyMap({
    rows: attachmentRows,
    key: (attachment) => attachment.key,
    sheet: SHEETS.attachments,
    field: "图片标识",
    issues,
  });

  const recordKeys = new Set(basePayload.records.map((record) => record.key));
  const claimKeys = new Set(claimByKey.keys());
  const evidenceKeys = new Set(evidenceByKey.keys());
  const sourceCheckKeys = new Set(sourceCheckByKey.keys());
  const attachmentCheckKeys = new Set(attachmentCheckByKey.keys());
  const allCheckKeys = new Set([...sourceCheckKeys, ...attachmentCheckKeys]);
  const reviewKeys = new Set(reviewByKey.keys());
  const attachmentKeys = new Set(attachmentByKey.keys());

  for (const key of sourceCheckKeys) {
    if (attachmentCheckKeys.has(key)) {
      issues.push({
        sheet: SHEETS.attachmentChecks,
        row: attachmentCheckByKey.get(key)!.row,
        field: "核验标识",
        message: "来源检查与附件检查的核验标识不能重复",
      });
    }
  }

  for (const row of claimRows) {
    checkReference(issues, {
      sheet: SHEETS.claims,
      row: row.row,
      field: "记录标识",
      key: row.data.recordKey,
      target: recordKeys,
      targetName: "记录",
    });
  }

  for (const row of evidenceRows) {
    checkReference(issues, {
      sheet: SHEETS.evidence,
      row: row.row,
      field: "主张标识",
      key: row.data.claimKey,
      target: claimKeys,
      targetName: "主张",
    });
    if (row.data.latestCheckKey) {
      checkReference(issues, {
        sheet: SHEETS.evidence,
        row: row.row,
        field: "最新检查标识",
        key: row.data.latestCheckKey,
        target: allCheckKeys,
        targetName: "核验",
      });
    }
    if (
      row.data.originalSourceCheckStatus === "unchecked" &&
      row.data.latestCheckKey !== null
    ) {
      issues.push({
        sheet: SHEETS.evidence,
        row: row.row,
        field: "最新检查标识",
        message: "原来源检查状态为 unchecked 时不能填写最新检查标识",
      });
    }
    if (
      row.data.originalSourceCheckStatus !== "unchecked" &&
      row.data.latestCheckKey === null
    ) {
      issues.push({
        sheet: SHEETS.evidence,
        row: row.row,
        field: "最新检查标识",
        message: "原来源检查状态不是 unchecked 时必须填写最新检查标识",
      });
    }
  }

  for (const row of [...sourceCheckRows, ...attachmentCheckRows]) {
    checkReference(issues, {
      sheet: sourceCheckByKey.has(row.data.key)
        ? SHEETS.sourceChecks
        : SHEETS.attachmentChecks,
      row: row.row,
      field: "证据标识",
      key: row.data.evidenceKey,
      target: evidenceKeys,
      targetName: "证据",
    });
    const evidence = evidenceByKey.get(row.data.evidenceKey)?.data;
    if (
      evidence &&
      row.data.evidenceVersion !== null &&
      row.data.evidenceVersion > evidence.version
    ) {
      issues.push({
        sheet: sourceCheckByKey.has(row.data.key)
          ? SHEETS.sourceChecks
          : SHEETS.attachmentChecks,
        row: row.row,
        field: "证据版本",
        message: "核验引用的证据版本不能高于当前证据版本",
      });
    }
  }

  for (const row of evidenceRows) {
    if (!row.data.latestCheckKey) continue;
    const check =
      sourceCheckByKey.get(row.data.latestCheckKey)?.data ??
      attachmentCheckByKey.get(row.data.latestCheckKey)?.data;
    if (check && check.evidenceKey !== row.data.key) {
      issues.push({
        sheet: SHEETS.evidence,
        row: row.row,
        field: "最新检查标识",
        message: "最新检查必须属于当前证据",
      });
    }
  }

  const seenCheckImages = new Set<string>();
  const attachmentCountByCheck = new Map<string, number>();
  for (const row of attachmentCheckImageRows) {
    checkReference(issues, {
      sheet: SHEETS.attachmentCheckImages,
      row: row.row,
      field: "核验标识",
      key: row.data.checkKey,
      target: attachmentCheckKeys,
      targetName: "附件检查",
    });
    checkReference(issues, {
      sheet: SHEETS.attachmentCheckImages,
      row: row.row,
      field: "图片标识",
      key: row.data.attachmentKey,
      target: attachmentKeys,
      targetName: "图片",
    });
    const pairKey = `${row.data.checkKey}\u0000${row.data.attachmentKey}`;
    if (seenCheckImages.has(pairKey)) {
      issues.push({
        sheet: SHEETS.attachmentCheckImages,
        row: row.row,
        field: "关联",
        message: "附件检查与图片关联重复",
      });
    }
    seenCheckImages.add(pairKey);
    attachmentCountByCheck.set(
      row.data.checkKey,
      (attachmentCountByCheck.get(row.data.checkKey) ?? 0) + 1,
    );

    const check = attachmentCheckByKey.get(row.data.checkKey)?.data;
    const attachment = attachmentByKey.get(row.data.attachmentKey)?.data;
    if (check && attachment && check.evidenceKey !== attachment.evidenceKey) {
      issues.push({
        sheet: SHEETS.attachmentCheckImages,
        row: row.row,
        field: "图片标识",
        message: "附件检查只能引用同一证据下的图片",
      });
    }
  }
  for (const row of attachmentCheckRows) {
    if ((attachmentCountByCheck.get(row.data.key) ?? 0) === 0) {
      issues.push({
        sheet: SHEETS.attachmentChecks,
        row: row.row,
        field: "核验标识",
        message: "附件检查至少需要关联一张图片",
      });
    }
  }

  const relativePaths = new Set<string>();
  for (const row of attachmentRows) {
    checkReference(issues, {
      sheet: SHEETS.attachments,
      row: row.row,
      field: "证据标识",
      key: row.data.evidenceKey,
      target: evidenceKeys,
      targetName: "证据",
    });
    const normalizedPath = row.data.relativePath.replace(/\\/g, "/").toLowerCase();
    if (relativePaths.has(normalizedPath)) {
      issues.push({
        sheet: SHEETS.attachments,
        row: row.row,
        field: "相对路径",
        message: "附件相对路径重复",
      });
    }
    relativePaths.add(normalizedPath);
  }

  const reviewNumbersByClaim = new Set<string>();
  for (const row of reviewRows) {
    checkReference(issues, {
      sheet: SHEETS.reviews,
      row: row.row,
      field: "主张标识",
      key: row.data.claimKey,
      target: claimKeys,
      targetName: "主张",
    });
    const key = `${row.data.claimKey}\u0000${row.data.reviewNumber}`;
    if (reviewNumbersByClaim.has(key)) {
      issues.push({
        sheet: SHEETS.reviews,
        row: row.row,
        field: "结论序号",
        message: "同一主张下的结论序号不能重复",
      });
    }
    reviewNumbersByClaim.add(key);
  }

  const seenReviewEvidence = new Set<string>();
  for (const row of reviewEvidenceRows) {
    checkReference(issues, {
      sheet: SHEETS.reviewEvidence,
      row: row.row,
      field: "结论标识",
      key: row.data.reviewKey,
      target: reviewKeys,
      targetName: "人工结论",
    });
    checkReference(issues, {
      sheet: SHEETS.reviewEvidence,
      row: row.row,
      field: "证据标识",
      key: row.data.evidenceKey,
      target: evidenceKeys,
      targetName: "证据",
    });
    checkReference(issues, {
      sheet: SHEETS.reviewEvidence,
      row: row.row,
      field: "核验标识",
      key: row.data.checkKey,
      target: allCheckKeys,
      targetName: "核验",
    });
    const pairKey = `${row.data.reviewKey}\u0000${row.data.evidenceKey}`;
    if (seenReviewEvidence.has(pairKey)) {
      issues.push({
        sheet: SHEETS.reviewEvidence,
        row: row.row,
        field: "关联",
        message: "同一人工结论不能重复引用同一证据",
      });
    }
    seenReviewEvidence.add(pairKey);

    const review = reviewByKey.get(row.data.reviewKey)?.data;
    const evidence = evidenceByKey.get(row.data.evidenceKey)?.data;
    const check =
      sourceCheckByKey.get(row.data.checkKey)?.data ??
      attachmentCheckByKey.get(row.data.checkKey)?.data;
    if (review && evidence) {
      const claim = claimByKey.get(evidence.claimKey)?.data;
      if (!claim || review.claimKey !== claim.key) {
        issues.push({
          sheet: SHEETS.reviewEvidence,
          row: row.row,
          field: "证据标识",
          message: "人工结论只能引用同一主张下的证据",
        });
      }
    }
    if (check && check.evidenceKey !== row.data.evidenceKey) {
      issues.push({
        sheet: SHEETS.reviewEvidence,
        row: row.row,
        field: "核验标识",
        message: "结论证据引用的核验必须属于当前证据",
      });
    }
  }

  const payload: PortablePayloadV2 = {
    formatVersion: DATA_TRANSFER_V2_FORMAT_VERSION,
    trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
    records: basePayload.records,
    categories: basePayload.categories,
    claims: claimRows.map((row) => row.data),
    evidence: evidenceRows.map((row) => row.data),
    sourceChecks: sourceCheckRows.map((row) => row.data),
    attachmentChecks: attachmentCheckRows.map((row) => row.data),
    attachmentCheckImages: attachmentCheckImageRows.map((row) => row.data),
    reviews: reviewRows.map((row) => row.data),
    reviewEvidence: reviewEvidenceRows.map((row) => row.data),
    attachments: attachmentRows.map((row) => row.data),
  };

  const payloadResult = portablePayloadV2Schema.safeParse(payload);
  if (!payloadResult.success) {
    for (const issue of payloadResult.error.issues) {
      issues.push({
        sheet: "工作簿",
        row: 0,
        field: issue.path.join(".") || "payload",
        message: issue.message,
      });
    }
  }

  return {
    payload: payloadResult.success ? payloadResult.data : payload,
    issues,
  };
}
