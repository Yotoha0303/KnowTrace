import { expect, test } from "@playwright/test";

test("capture → AI review → accepted knowledge structure", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
      console.error("browser console:", message.text());
    }
  });
  page.on("pageerror", (error) => console.error("browser pageerror:", error.message));

  const suffix = Date.now().toString().slice(-6);
  const categoryName = `AI 实践 ${suffix}`;
  const title = `散碎知识整理 ${suffix}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "先留下，再慢慢想清楚。" })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);

  await page.getByLabel("新分类名称").fill(categoryName);
  await expect(page.getByLabel("创建分类")).toBeEnabled({ timeout: 5_000 });
  await page.getByLabel("创建分类").click();
  await expect(page.getByRole("link", { name: new RegExp(categoryName) })).toBeVisible();

  await page.getByPlaceholder("标题可以稍后再补").fill(title);
  await page
    .getByPlaceholder(/输入关键词/)
    .fill("软件；AI接入管理知识库；输入不确定性，输出结构化和系统化的内容");
  await page.locator(".category-picker summary").click();
  await page.getByRole("button", { name: categoryName }).click();
  await page.getByRole("button", { name: /保存并整理/ }).click();

  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "AI 整理台" })).toBeVisible();
  await page.getByLabel("处理引擎").selectOption("openai");
  await expect(page.getByLabel("OpenAI 连接方式")).toBeVisible();
  await expect(page.getByLabel("OpenAI 连接方式")).toHaveValue(
    "ccswitch_codex_oauth",
  );
  await expect(page.getByRole("button", { name: "测试 AI 连接" })).toBeVisible();
  await expect(page.locator(".connection-check")).toContainText(
    /正在自动检测|已检测到|未能连接/,
  );
  await expect(page.getByLabel("CC-Switch 地址")).not.toBeVisible();
  await page.getByText("高级设置（通常无需修改）").click();
  await expect(page.getByLabel("CC-Switch 地址")).toHaveValue(
    "http://host.docker.internal:15721/v1",
  );
  await expect(page.getByLabel("CC-Switch 代理令牌")).toBeVisible();
  await expect(page.getByLabel("CC-Switch Claude 路由模型")).toHaveValue(
    "claude-sonnet-4-5",
  );
  await page.screenshot({
    fullPage: true,
    path: "test-results/ai-connection-ui.png",
  });
  await page.getByLabel("OpenAI 连接方式").selectOption("api_key");
  await page.getByLabel("OpenAI API Key").fill("sk-openai-session-test");
  await page.getByLabel("仅在当前浏览器标签页记住凭据").check();
  await page.reload();
  await page.getByLabel("处理引擎").selectOption("openai");
  await expect(page.getByLabel("OpenAI 连接方式")).toHaveValue("api_key");
  await expect(page.getByLabel("OpenAI API Key")).toHaveValue(
    "sk-openai-session-test",
  );
  await page.getByLabel("仅在当前浏览器标签页记住凭据").uncheck();
  await page.getByLabel("OpenAI 连接方式").selectOption("ccswitch_codex_oauth");
  await page.getByText("高级设置（通常无需修改）").click();
  await page.getByLabel("CC-Switch 地址").fill("https://example.com/v1");
  await expect(
    page.getByText(/CC-Switch 仅允许使用本机 HTTP\(S\) 地址/),
  ).toBeVisible();
  await page.getByLabel("处理引擎").selectOption("deepseek");
  await expect(page.getByLabel("DeepSeek API Key")).toBeVisible();
  await page.getByLabel("处理引擎").selectOption("mock");
  await page.getByRole("button", { name: /开始 AI 整理/ }).click();
  await expect(page.getByText("等待你的决定")).toBeVisible();
  await expect(page.getByText("这是本地规则生成的演示建议，不包含事实核验。")).toBeVisible();
  await expect(page.locator(".review-options label")).toHaveCount(1);
  await expect(page.locator(".content-suggestion-list label")).toHaveCount(1);
  await page.locator(".content-suggestion-list input").check();

  await page.getByRole("button", { name: /接受当前选择/ }).click();
  await expect(page.getByText("生成一份可审阅的整理建议")).toBeVisible();
  await expect(page.getByLabel("标题")).toHaveValue(title);
  await expect(page.getByLabel("原文")).toHaveValue(/将不确定输入整理为结构化、系统化内容/);
  await page.locator(".history-list summary").click();
  await expect(page.getByText(/修改后接受/)).toBeVisible();

  await page.screenshot({ fullPage: true, path: "test-results/knowtrace-flow.png" });
  await page.getByRole("link", { name: /返回收集箱/ }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("heading", { name: title }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
