import { expect, test } from "@playwright/test";

test("topic synthesis keeps traceable sources and detects changed input", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const suffix = Date.now().toString().slice(-6);
  const categoryName = `综合档案 ${suffix}`;
  const title = `主题源记录 ${suffix}`;

  await page.goto("/");
  await page.getByLabel("新分类名称").fill(categoryName);
  await page.getByLabel("创建分类").click();
  await page.getByPlaceholder("标题可以稍后再补").fill(title);
  await page.getByPlaceholder(/输入关键词/).fill("这条材料用于验证主题综合、来源回链和输入变化检测。");
  await page.locator(".category-picker summary").click();
  await page.getByRole("button", { name: categoryName, exact: true }).click();
  await page.getByRole("button", { name: /保存并整理/ }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  const captureUrl = page.url();

  await page.locator(".category-nav").getByRole("link", { name: new RegExp(categoryName) }).click();
  await expect(page.getByRole("heading", { name: "主题综合档案" })).toBeVisible();
  await expect(page.getByLabel("处理方式")).toHaveValue("mock");
  await page.getByRole("button", { name: "生成主题综合档案" }).click();
  await expect(page.getByText(/当前汇集 1 条记录/)).toBeVisible();
  await expect(page.locator(".topic-source-links").getByRole("link", { name: title }).first()).toBeVisible();
  await expect(page.getByText(/不会联网补证/)).toBeVisible();
  await page.getByRole("button", { name: "接受为当前档案" }).click();
  await expect(page.locator(".topic-decision")).toHaveText("已接受");

  await page.goto(captureUrl);
  await page.getByLabel("标题").fill(`${title} 已更新`);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.locator(".form-saved")).toContainText("已保存版本");
  await page.locator(".category-nav").getByRole("link", { name: new RegExp(categoryName) }).click();
  await expect(page.getByText("输入已变化", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "基于当前输入重新生成" })).toBeVisible();

  await page.getByRole("button", { name: "基于当前输入重新生成" }).click();
  await expect(page.locator(".topic-decision")).toHaveText("待决定");
  await expect(page.getByText("输入已变化", { exact: true })).toHaveCount(0);
  await page.screenshot({ fullPage: true, path: "test-results/topic-synthesis.png" });

  await page.goto(captureUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await page.goto("/categories");
  const categoryRow = page.locator(".category-manage-row").filter({
    has: page.getByLabel(`${categoryName}的名称`),
  });
  page.once("dialog", (dialog) => dialog.accept());
  await categoryRow.getByRole("button", { name: "删除" }).click();
  await expect(categoryRow).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
