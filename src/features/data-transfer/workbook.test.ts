import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { createPortableWorkbook, parsePortableWorkbook } from "./workbook";

const payload = {
  formatVersion: "1" as const,
  records: [{
    key: "record-001",
    title: "一次观察",
    content: "保留的原始内容",
    contentType: "observation" as const,
    subject: "某公司",
    occurredAt: "2026-08-23T02:30:00.000Z",
    status: "active" as const,
    categoryKeys: ["category-001"],
  }],
  categories: [{ key: "category-001", name: "案例", description: "测试分类", status: "active" as const }],
};

describe("KnowTrace portable workbook", () => {
  it("round-trips records, subject, time, and category relationships", async () => {
    const buffer = await createPortableWorkbook(payload);
    const parsed = await parsePortableWorkbook(buffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.payload).toEqual(payload);
  });

  it("rejects formulas in import data cells", async () => {
    const source = await createPortableWorkbook(payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(source).buffer);
    workbook.getWorksheet("记录")!.getCell("C2").value = { formula: 'HYPERLINK("https://example.com")', result: "外部内容" };
    const modified = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parsePortableWorkbook(modified);
    expect(parsed.issues).toContainEqual(expect.objectContaining({ sheet: "记录", row: 2, message: "数据单元格不能使用公式" }));
  });
});
