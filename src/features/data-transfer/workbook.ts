import ExcelJS, { type Cell, type Worksheet } from "exceljs";

import {
  DATA_TRANSFER_FORMAT_VERSION,
  DATA_TRANSFER_MAX_CATEGORIES,
  DATA_TRANSFER_MAX_RECORDS,
  DATA_TRANSFER_MAX_RELATIONSHIPS,
  type ImportIssue,
  type PortableCategory,
  type PortablePayload,
  type PortableRecord,
  portableCategorySchema,
  portablePayloadSchema,
  portableRecordSchema,
} from "./contracts";

const SHEETS = {
  instructions: "使用说明",
  records: "记录",
  categories: "分类",
  relationships: "记录分类",
  metadata: "元数据",
} as const;

const RECORD_HEADERS = ["记录标识", "标题", "原文", "内容类型", "描述对象", "发生时间", "状态"] as const;
const CATEGORY_HEADERS = ["分类标识", "名称", "说明", "状态"] as const;
const RELATIONSHIP_HEADERS = ["记录标识", "分类标识"] as const;

const headerFill = "1A2B23";
const accentFill = "CFFF78";
const lineColor = "D9DED7";

function styleDataSheet(sheet: Worksheet, widths: number[]) {
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(widths.length).address };
  sheet.columns.forEach((column, index) => {
    column.width = widths[index];
    column.alignment = { vertical: "top", wrapText: index === 2 };
  });
  const header = sheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${headerFill}` } };
  header.alignment = { vertical: "middle", horizontal: "left" };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: `FF${lineColor}` } } };
  });
}

export async function createPortableWorkbook(payload: PortablePayload): Promise<Buffer> {
  const parsed = portablePayloadSchema.parse(payload);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KnowTrace";
  workbook.created = new Date();
  workbook.modified = new Date();

  const instructions = workbook.addWorksheet(SHEETS.instructions, { views: [{ showGridLines: false }] });
  instructions.columns = [{ width: 24 }, { width: 92 }];
  instructions.mergeCells("A1:B1");
  instructions.getCell("A1").value = "KnowTrace 数据交换文件";
  instructions.getCell("A1").font = { bold: true, size: 20, color: { argb: `FF${headerFill}` } };
  instructions.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${accentFill}` } };
  instructions.getCell("A1").alignment = { vertical: "middle" };
  instructions.getRow(1).height = 38;
  const notes = [
    ["格式版本", DATA_TRANSFER_FORMAT_VERSION],
    ["可迁移内容", "记录原文、标题、内容类型、描述对象、发生时间、归档状态、分类及其关联。"],
    ["不会迁移", "AI 处理历史、主张、证据、审核结论、可靠知识发布和图片。它们必须通过 PostgreSQL 数据库与 data/uploads 完整备份。"],
    ["导入流程", "上传后只做预检；只有预检通过并再次点击“确认导入”才会写入数据库。"],
    ["重复规则", "记录标识和分类标识必须稳定且唯一。系统还会在当前用户范围内比较标题、对象、发生时间、类型和原文指纹；重复记录会跳过，同一标识内容不一致会阻止导入。"],
    ["编辑要求", "不要改工作表名称或表头。发生时间建议使用 ISO 8601，例如 2026-08-23T10:30:00.000Z。状态仅可填写 active 或 archived。"],
  ];
  instructions.addRows(notes);
  instructions.getColumn(1).font = { bold: true, color: { argb: "FF536059" } };
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  for (let row = 2; row <= notes.length + 1; row += 1) instructions.getRow(row).height = row === 4 ? 46 : 34;

  const records = workbook.addWorksheet(SHEETS.records);
  records.addRow(RECORD_HEADERS);
  for (const record of parsed.records) {
    records.addRow([record.key, record.title ?? "", record.content, record.contentType, record.subject ?? "", new Date(record.occurredAt), record.status]);
  }
  styleDataSheet(records, [40, 30, 78, 20, 28, 25, 14]);
  records.getColumn(6).numFmt = "yyyy-mm-dd hh:mm:ss";
  records.getColumn(4).eachCell({ includeEmpty: true }, (cell, row) => {
    if (row > 1) cell.dataValidation = { type: "list", allowBlank: false, formulae: ['"keyword_set,thought_fragment,experience,observation,question,source_note,mixed,unknown"'] };
  });
  records.getColumn(7).eachCell({ includeEmpty: true }, (cell, row) => {
    if (row > 1) cell.dataValidation = { type: "list", allowBlank: false, formulae: ['"active,archived"'] };
  });

  const categories = workbook.addWorksheet(SHEETS.categories);
  categories.addRow(CATEGORY_HEADERS);
  for (const category of parsed.categories) categories.addRow([category.key, category.name, category.description ?? "", category.status]);
  styleDataSheet(categories, [40, 28, 70, 14]);
  categories.getColumn(4).eachCell({ includeEmpty: true }, (cell, row) => {
    if (row > 1) cell.dataValidation = { type: "list", allowBlank: false, formulae: ['"active,archived"'] };
  });

  const relationships = workbook.addWorksheet(SHEETS.relationships);
  relationships.addRow(RELATIONSHIP_HEADERS);
  for (const record of parsed.records) {
    for (const categoryKey of record.categoryKeys) relationships.addRow([record.key, categoryKey]);
  }
  styleDataSheet(relationships, [40, 40]);

  const metadata = workbook.addWorksheet(SHEETS.metadata, { state: "veryHidden" });
  metadata.addRows([["format_version", DATA_TRANSFER_FORMAT_VERSION], ["generator", "KnowTrace"]]);

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function isFormula(cell: Cell): boolean {
  return Boolean(cell.value && typeof cell.value === "object" && "formula" in cell.value);
}

function cellText(cell: Cell): string {
  if (cell.value instanceof Date) return cell.value.toISOString();
  return cell.text.trim();
}

function nullableCellText(cell: Cell): string | null {
  const value = cellText(cell);
  return value.length ? value : null;
}

function validateHeaders(sheet: Worksheet | undefined, headers: readonly string[], issues: ImportIssue[]): sheet is Worksheet {
  if (!sheet) {
    issues.push({ sheet: "工作簿", row: 0, field: "工作表", message: `缺少“${headers === RECORD_HEADERS ? SHEETS.records : headers === CATEGORY_HEADERS ? SHEETS.categories : SHEETS.relationships}”工作表` });
    return false;
  }
  headers.forEach((header, index) => {
    if (cellText(sheet.getRow(1).getCell(index + 1)) !== header) {
      issues.push({ sheet: sheet.name, row: 1, field: header, message: `第 ${index + 1} 列表头必须是“${header}”` });
    }
  });
  return true;
}

function pushZodIssues(issues: ImportIssue[], sheet: string, row: number, result: ReturnType<typeof portableRecordSchema.safeParse> | ReturnType<typeof portableCategorySchema.safeParse>) {
  if (result.success) return;
  for (const issue of result.error.issues) {
    issues.push({ sheet, row, field: String(issue.path[0] ?? "行"), message: issue.message });
  }
}

export async function parsePortableWorkbook(buffer: Buffer): Promise<{ payload: PortablePayload; issues: ImportIssue[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  const issues: ImportIssue[] = [];
  const metadata = workbook.getWorksheet(SHEETS.metadata);
  const formatVersion = metadata ? cellText(metadata.getCell("B1")) : "";
  if (formatVersion !== DATA_TRANSFER_FORMAT_VERSION) {
    issues.push({ sheet: SHEETS.metadata, row: 1, field: "format_version", message: `仅支持格式版本 ${DATA_TRANSFER_FORMAT_VERSION}` });
  }

  const recordsSheet = workbook.getWorksheet(SHEETS.records);
  const categoriesSheet = workbook.getWorksheet(SHEETS.categories);
  const relationshipsSheet = workbook.getWorksheet(SHEETS.relationships);
  const records: PortableRecord[] = [];
  const categories: PortableCategory[] = [];
  const relationRows: Array<{ recordKey: string; categoryKey: string; row: number }> = [];

  if (validateHeaders(recordsSheet, RECORD_HEADERS, issues)) {
    for (let row = 2; row <= recordsSheet.actualRowCount; row += 1) {
      const cells = RECORD_HEADERS.map((_, index) => recordsSheet.getRow(row).getCell(index + 1));
      if (cells.every((cell) => cellText(cell) === "")) continue;
      cells.forEach((cell, index) => {
        if (isFormula(cell)) issues.push({ sheet: SHEETS.records, row, field: RECORD_HEADERS[index], message: "数据单元格不能使用公式" });
      });
      const occurredCell = cells[5];
      let occurredAt = cellText(occurredCell);
      if (!(occurredCell.value instanceof Date) && occurredAt) {
        const date = new Date(occurredAt);
        occurredAt = Number.isNaN(date.getTime()) ? occurredAt : date.toISOString();
      }
      const result = portableRecordSchema.safeParse({
        key: cellText(cells[0]), title: nullableCellText(cells[1]), content: cellText(cells[2]),
        contentType: cellText(cells[3]), subject: nullableCellText(cells[4]), occurredAt,
        status: cellText(cells[6]), categoryKeys: [],
      });
      pushZodIssues(issues, SHEETS.records, row, result);
      if (result.success) records.push(result.data);
    }
  }

  if (validateHeaders(categoriesSheet, CATEGORY_HEADERS, issues)) {
    for (let row = 2; row <= categoriesSheet.actualRowCount; row += 1) {
      const cells = CATEGORY_HEADERS.map((_, index) => categoriesSheet.getRow(row).getCell(index + 1));
      if (cells.every((cell) => cellText(cell) === "")) continue;
      cells.forEach((cell, index) => {
        if (isFormula(cell)) issues.push({ sheet: SHEETS.categories, row, field: CATEGORY_HEADERS[index], message: "数据单元格不能使用公式" });
      });
      const result = portableCategorySchema.safeParse({
        key: cellText(cells[0]), name: cellText(cells[1]), description: nullableCellText(cells[2]), status: cellText(cells[3]),
      });
      pushZodIssues(issues, SHEETS.categories, row, result);
      if (result.success) categories.push(result.data);
    }
  }

  if (validateHeaders(relationshipsSheet, RELATIONSHIP_HEADERS, issues)) {
    for (let row = 2; row <= relationshipsSheet.actualRowCount; row += 1) {
      const recordKey = cellText(relationshipsSheet.getRow(row).getCell(1));
      const categoryKey = cellText(relationshipsSheet.getRow(row).getCell(2));
      if (!recordKey && !categoryKey) continue;
      if (!recordKey || !categoryKey) issues.push({ sheet: SHEETS.relationships, row, field: "关联", message: "记录标识和分类标识都必须填写" });
      else relationRows.push({ recordKey, categoryKey, row });
    }
  }

  if (records.length > DATA_TRANSFER_MAX_RECORDS) issues.push({ sheet: SHEETS.records, row: 0, field: "数量", message: `一次最多导入 ${DATA_TRANSFER_MAX_RECORDS} 条记录` });
  if (categories.length > DATA_TRANSFER_MAX_CATEGORIES) issues.push({ sheet: SHEETS.categories, row: 0, field: "数量", message: `一次最多导入 ${DATA_TRANSFER_MAX_CATEGORIES} 个分类` });
  if (relationRows.length > DATA_TRANSFER_MAX_RELATIONSHIPS) issues.push({ sheet: SHEETS.relationships, row: 0, field: "数量", message: `一次最多导入 ${DATA_TRANSFER_MAX_RELATIONSHIPS} 条关联` });

  const recordKeys = new Set<string>();
  for (const [index, record] of records.entries()) {
    if (recordKeys.has(record.key)) issues.push({ sheet: SHEETS.records, row: index + 2, field: "记录标识", message: "记录标识重复" });
    recordKeys.add(record.key);
  }
  const categoryKeys = new Set<string>();
  const categoryNames = new Set<string>();
  for (const [index, category] of categories.entries()) {
    const normalizedName = category.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    if (categoryKeys.has(category.key)) issues.push({ sheet: SHEETS.categories, row: index + 2, field: "分类标识", message: "分类标识重复" });
    if (categoryNames.has(normalizedName)) issues.push({ sheet: SHEETS.categories, row: index + 2, field: "名称", message: "规范化后的分类名称重复" });
    categoryKeys.add(category.key);
    categoryNames.add(normalizedName);
  }
  const relationshipsByRecord = new Map<string, Set<string>>();
  for (const relation of relationRows) {
    if (!recordKeys.has(relation.recordKey)) issues.push({ sheet: SHEETS.relationships, row: relation.row, field: "记录标识", message: "找不到对应记录" });
    if (!categoryKeys.has(relation.categoryKey)) issues.push({ sheet: SHEETS.relationships, row: relation.row, field: "分类标识", message: "找不到对应分类" });
    const values = relationshipsByRecord.get(relation.recordKey) ?? new Set<string>();
    values.add(relation.categoryKey);
    relationshipsByRecord.set(relation.recordKey, values);
  }
  for (const record of records) {
    record.categoryKeys = [...(relationshipsByRecord.get(record.key) ?? [])];
    if (record.categoryKeys.length > 20) issues.push({ sheet: SHEETS.relationships, row: 0, field: record.key, message: "每条记录最多关联 20 个分类" });
  }

  return { payload: { formatVersion: DATA_TRANSFER_FORMAT_VERSION, records, categories }, issues };
}
