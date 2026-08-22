import { expect, test } from "@playwright/test";

test("empty categories can be deleted while used categories are protected", async ({ page }) => {
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
  await expect(emptyRow).toContainText("0 条记录");
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

  await page.goto("/categories");
  const usedRow = categoryRow(usedName);
  await expect(usedRow).toContainText("1 条记录");
  await expect(usedRow.getByRole("button", { name: "删除" })).toBeDisabled();

  await page.goto(captureUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/categories");
  await expect(usedRow).toContainText("0 条记录");
  await expect(usedRow.getByRole("button", { name: "删除" })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await usedRow.getByRole("button", { name: "删除" }).click();
  await expect(usedRow).toHaveCount(0);

  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
