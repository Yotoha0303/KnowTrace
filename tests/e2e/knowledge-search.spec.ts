import { expect, test } from "@playwright/test";

test("capture → category dossier → unified search", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const suffix = Date.now().toString().slice(-6);
  const categoryName = `检索主题 ${suffix}`;
  const title = `输入不确定性 ${suffix}`;
  const keyword = `结构化线索${suffix}`;

  await page.goto("/");
  await page.getByLabel("新分类名称").fill(categoryName);
  await page.getByLabel("创建分类").click();
  await expect(page.getByRole("link", { name: new RegExp(categoryName) })).toBeVisible();

  await page.getByPlaceholder("标题可以稍后再补").fill(title);
  await page.getByPlaceholder(/输入关键词/).fill(`${keyword}；把散碎输入整理为系统化知识。`);
  await page.locator(".category-picker summary").click();
  await page.getByRole("button", { name: categoryName }).click();
  await page.getByRole("button", { name: /保存并整理/ }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);

  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "知识检索" })).toBeVisible();
  await page.getByLabel("检索知识库").fill(keyword);
  await page.getByLabel("知识分类").selectOption({ label: categoryName });
  await page.getByRole("button", { name: "检索" }).click();

  await expect(page).toHaveURL(/\/search\?.*q=/);
  await expect(page.getByRole("heading", { name: "原始记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator(".search-result-card.is-capture")).toContainText(categoryName);
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await page.screenshot({ fullPage: true, path: "test-results/knowledge-search.png" });

  await page.locator(".category-nav").getByRole("link", { name: new RegExp(categoryName) }).click();
  await expect(page.locator(".dossier-metrics article").first()).toContainText("1");
  await expect(page.getByRole("heading", { name: "主题记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByRole("heading", { name: title }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
  expect(consoleErrors).toEqual([]);
});
