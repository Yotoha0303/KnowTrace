import { expect, test } from "@playwright/test";

test("sidebar keeps category controls clear of the reliability note", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto("/");
  await expect(page.getByLabel("新分类名称")).toBeVisible();

  await page.locator(".category-nav").evaluate((navigation) => {
    for (let index = 0; index < 20; index += 1) {
      const link = document.createElement("a");
      link.href = "#";
      link.innerHTML = `<span>布局压力测试分类 ${index + 1}</span><small>${index}</small>`;
      navigation.append(link);
    }
  });

  const categoryNavigation = page.locator(".category-nav");
  await expect
    .poll(() =>
      categoryNavigation.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await categoryNavigation.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const creatorBox = await page.locator(".category-create").boundingBox();
  const noteBox = await page.locator(".sidebar-note").boundingBox();
  expect(creatorBox).not.toBeNull();
  expect(noteBox).not.toBeNull();
  expect(creatorBox!.y + creatorBox!.height).toBeLessThanOrEqual(noteBox!.y - 12);
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: "test-results/sidebar-layout.png",
  });
});
