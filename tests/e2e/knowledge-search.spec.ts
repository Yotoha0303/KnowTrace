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
  const subject = `星轨公司${suffix}`;

  await page.goto("/");
  await page.getByLabel("新分类名称").fill(categoryName);
  await page.getByLabel("创建分类").click();
  await expect(page.getByRole("link", { name: new RegExp(categoryName) })).toBeVisible();

  await page.getByPlaceholder("标题可以稍后再补").fill(title);
  await page.getByPlaceholder(/输入关键词/).fill(`${keyword}；把散碎输入整理为系统化知识。`);
  await expect(page.getByLabel("发生时间")).not.toHaveValue("");
  await page.getByLabel("描述对象").fill(subject);
  await page.getByLabel("发生时间").fill("2024-06-15T09:30");
  await page.locator(".category-picker summary").click();
  await page.getByRole("button", { name: categoryName }).click();
  await page.getByRole("button", { name: /保存并整理/ }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  await expect(page.getByLabel("描述对象")).toHaveValue(subject);
  await expect(page.getByLabel("发生时间")).toHaveValue("2024-06-15T09:30");

  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "知识检索" })).toBeVisible();
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).formatToParts(new Date());
  const todayValues = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
  const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
  await expect(page.getByLabel("发生时间开始日期")).toHaveValue(today);
  await expect(page.getByLabel("发生时间结束日期")).toHaveValue(today);
  await page.getByLabel("发生时间开始日期").fill("");
  await page.getByLabel("发生时间结束日期").fill("");
  await page.getByLabel("检索知识库").fill(subject);
  await page.getByLabel("知识分类").selectOption({ label: categoryName });
  await page.getByRole("button", { name: "检索" }).click();

  await expect(page).toHaveURL(/\/search\?.*q=/);
  await expect(page.getByLabel("发生时间开始日期")).toHaveValue("");
  await expect(page.getByLabel("发生时间结束日期")).toHaveValue("");
  await expect(page.getByRole("heading", { name: "原始记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator(".search-result-card.is-capture")).toContainText(categoryName);
  await expect(page.locator(".search-result-card.is-capture")).toContainText(subject);
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await page.screenshot({ fullPage: true, path: "test-results/knowledge-search.png" });

  await page.getByLabel("检索知识库").fill("");
  await page.getByLabel("按描述对象筛选").fill(subject.slice(0, -2));
  await page.getByLabel("发生时间开始日期").fill("2024-06-15");
  await page.getByLabel("发生时间结束日期").fill("2024-06-15");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.locator(".category-nav").getByRole("link", { name: new RegExp(categoryName) }).click();
  await expect(page.locator(".dossier-metrics article").first()).toContainText("1");
  await expect(page.getByRole("heading", { name: "主题记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByRole("heading", { name: title }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/categories");
  const categoryRow = page.locator(".category-manage-row").filter({
    has: page.getByLabel(`${categoryName}的名称`),
  });
  page.once("dialog", (dialog) => dialog.accept());
  await categoryRow.getByRole("button", { name: "删除" }).click();
  await expect(categoryRow).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
