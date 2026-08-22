import { expect, test, type Page } from "@playwright/test";

async function createCapture(
  page: Page,
  input: { title: string; subject: string; content: string },
) {
  await page.goto("/");
  await page.getByPlaceholder("标题可以稍后再补").fill(input.title);
  await page.getByLabel("描述对象").fill(input.subject);
  await page.getByPlaceholder(/输入关键词/).fill(input.content);
  await page.getByRole("button", { name: /保存并整理/ }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  return page.url();
}

test("capture detail explains and links similar records", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const suffix = Date.now().toString().slice(-6);
  const subject = `星桥公司${suffix}`;
  const firstTitle = `客户投诉复盘 ${suffix}`;
  const secondTitle = `客户投诉再次处理 ${suffix}`;
  const firstUrl = await createCapture(page, {
    title: firstTitle,
    subject,
    content: "客户投诉升级后，应先记录事实、确认责任边界，再给出明确处理时限。",
  });
  const secondUrl = await createCapture(page, {
    title: secondTitle,
    subject,
    content: "再次遇到客户投诉升级，需要先记录事实并确认责任边界，然后约定处理时限。",
  });

  const panel = page.locator(".similar-captures-panel");
  await expect(panel.getByRole("heading", { name: "相似记录" })).toBeVisible();
  await expect(panel).toContainText("相似不代表观点一致、内容真实或已经验证");
  await expect(panel.getByRole("heading", { name: firstTitle })).toBeVisible();
  await expect(panel.getByText("同一描述对象")).toBeVisible();
  await expect(panel.getByText(/文字相似 \d+%/)).toBeVisible();
  await expect(panel.getByRole("heading", { name: secondTitle })).toHaveCount(0);
  await page.screenshot({ fullPage: true, path: "test-results/similar-captures.png" });

  await panel.getByRole("heading", { name: firstTitle }).click();
  await expect(page).toHaveURL(firstUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(secondUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(consoleErrors).toEqual([]);
});
