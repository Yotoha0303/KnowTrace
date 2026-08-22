import { expect, test, type Page } from "@playwright/test";

async function createSubjectCapture(
  page: Page,
  input: { title: string; subject: string; occurredAt: string; content: string },
) {
  await page.goto("/");
  await page.getByPlaceholder("标题可以稍后再补").fill(input.title);
  await page.getByLabel("描述对象").fill(input.subject);
  await page.getByLabel("发生时间").fill(input.occurredAt);
  await page.getByPlaceholder(/输入关键词/).fill(input.content);
  await page.getByRole("button", { name: /保存并整理/ }).click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  return page.url();
}

test("subject index builds an occurred-at timeline with source links", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const subject = `对象时间线公司${suffix}`;
  const earlyTitle = `早期事件 ${suffix}`;
  const laterTitle = `后续事件 ${suffix}`;
  const earlyUrl = await createSubjectCapture(page, {
    title: earlyTitle,
    subject,
    occurredAt: "2023-03-04T09:15",
    content: "首次记录该对象的事件背景和当时观察。",
  });
  const laterUrl = await createSubjectCapture(page, {
    title: laterTitle,
    subject,
    occurredAt: "2025-11-19T16:30",
    content: "后续记录同一对象出现的新情况和处理结果。",
  });

  await page.locator(".detail-meta").getByRole("link", { name: subject, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/subjects/${encodeURIComponent(subject)}`));
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  await expect(page.getByText("共 2 个时间点")).toBeVisible();
  await expect(page.locator(".subject-timeline-card h2")).toHaveText([earlyTitle, laterTitle]);
  await expect(page.locator(".subject-timeline-event time")).toHaveCount(2);
  await expect(page.getByText("不能反推为事件发生时间")).toBeVisible();
  await page.screenshot({ fullPage: true, path: "test-results/subject-timeline.png" });

  await page.goto(earlyUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);
  await page.goto(laterUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);
});
