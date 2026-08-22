import { expect, test } from "@playwright/test";

test("sidebar counts active records while category deletion protects all records", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const suffix = Date.now().toString().slice(-6);
  const emptyName = `待删除空分类 ${suffix}`;
  const usedName = `有关联分类 ${suffix}`;

  await page.goto("/categories");
  const creator = page.locator(".category-create-card");
  const categoryRow = (name: string) =>
    page
      .locator(".category-manage-row")
      .filter({ has: page.getByLabel(`${name}的名称`) });
  await creator.getByLabel("新分类名称").fill(emptyName);
  await creator.getByRole("button", { name: "创建分类" }).click();
  const emptyRow = categoryRow(emptyName);
  await expect(emptyRow.getByLabel(`${emptyName}记录统计`)).toContainText(
    "使用中 0 条 · 已归档 0 条 · 共 0 条",
  );
  await expect(emptyRow.getByRole("button", { name: "删除" })).toBeEnabled();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(`永久删除空分类“${emptyName}”`);
    await dialog.accept();
  });
  await emptyRow.getByRole("button", { name: "删除" }).click();
  await expect(emptyRow).toHaveCount(0);

  await creator.getByLabel("新分类名称").fill(usedName);
  await creator.getByRole("button", { name: "创建分类" }).click();
  await expect(categoryRow(usedName)).toBeVisible();

  await page.goto("/");
  await page.getByPlaceholder("标题可以稍后再补").fill(`分类删除保护 ${suffix}`);
  await page.getByPlaceholder(/输入关键词/).fill("这条记录用于验证有关联分类不能删除。");
  await page.locator(".category-picker summary").click();
  await page.getByRole("button", { name: usedName, exact: true }).click();
  await page.getByRole("button", { name: /保存并整理/ }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  const captureUrl = page.url();
  const title = `分类删除保护 ${suffix}`;

  await expect(page.getByLabel(`${usedName}使用中记录数`)).toHaveText("1");
  await page.getByRole("button", { name: "归档" }).click();
  await expect(page).toHaveURL(/\/archived$/);
  await expect(page.getByLabel(`${usedName}使用中记录数`)).toHaveText("0");

  await page.locator(".category-nav").getByRole("link", { name: new RegExp(usedName) }).click();
  await expect(page.locator(".dossier-metrics article").first()).toContainText("0");
  await expect(page.locator(".dossier-metrics article").first()).toContainText("1 条已归档");
  await expect(page.getByText("这个分类还是空的")).toBeVisible();

  await page.goto("/categories");
  const usedRow = categoryRow(usedName);
  await expect(usedRow.getByLabel(`${usedName}记录统计`)).toContainText(
    "使用中 0 条 · 已归档 1 条 · 共 1 条",
  );
  await expect(usedRow.getByLabel(`${usedName}记录统计`)).toContainText(
    "分类状态：使用中",
  );
  await expect(usedRow.getByRole("button", { name: "删除" })).toBeDisabled();

  await page.goto("/archived");
  await page.getByRole("heading", { name: title }).click();
  await expect(page).toHaveURL(captureUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/categories");
  await expect(usedRow.getByLabel(`${usedName}记录统计`)).toContainText(
    "使用中 0 条 · 已归档 0 条 · 共 0 条",
  );
  await expect(usedRow.getByRole("button", { name: "删除" })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await usedRow.getByRole("button", { name: "删除" }).click();
  await expect(usedRow).toHaveCount(0);

  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
