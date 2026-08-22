import { expect, test } from "@playwright/test";

test.skip(
  process.env.RUN_DEEPSEEK_E2E !== "1" || !process.env.DEEPSEEK_E2E_KEY,
  "Set RUN_DEEPSEEK_E2E=1 and DEEPSEEK_E2E_KEY to run this paid UI-key test.",
);

test("@deepseek organizes a real capture", async ({ page }) => {
  test.setTimeout(150_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const title = `DeepSeek 接入测试 ${Date.now().toString().slice(-6)}`;
  await page.goto("/");
  await page.getByPlaceholder("标题可以稍后再补").fill(title);
  await page
    .getByPlaceholder(/输入关键词/)
    .fill(
      "软件/程序；AI接入管理知识库；输入不确定性，输出结构化和系统化的内容。这个知识库需要帮助我继续学习和积累经验。",
    );
  await page.getByRole("button", { name: /保存并整理/ }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);

  await page.getByLabel("处理引擎").selectOption("deepseek");
  await page.getByLabel("DeepSeek API Key").fill(process.env.DEEPSEEK_E2E_KEY!);
  await page.getByRole("button", { name: /开始分析版本/ }).click();
  await expect(page.getByText("DeepSeek 正在整理")).toBeVisible();
  await expect(page.getByText(/正在分析原文|正在等待模型/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("等待你的决定")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".suggestion-block").first()).toBeVisible();
  expect(await page.locator(".review-options label").count()).toBeLessThanOrEqual(3);
  expect(await page.locator(".review-options em").count()).toBeLessThanOrEqual(1);
  await page.screenshot({
    fullPage: true,
    path: "test-results/deepseek-real-flow.png",
  });

  await page.getByRole("button", { name: /接受当前选择/ }).click();
  await expect(page.getByText("生成一份可审阅的整理建议")).toBeVisible();
  await page.locator(".history-list summary").click();
  await expect(page.getByText(/DeepSeek \/ deepseek-v4-flash/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);
  expect(consoleErrors).toEqual([]);
});
