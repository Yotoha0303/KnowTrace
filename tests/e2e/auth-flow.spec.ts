import { expect, test } from "@playwright/test";

const username = process.env.AUTH_E2E_USERNAME;
const password = process.env.AUTH_E2E_PASSWORD;

test("go-user-system login, refresh recovery and logout", async ({ context, page }) => {
  test.skip(!username || !password, "requires a running go-user-system test account");

  await page.goto("/search?type=capture");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("heading", { name: "登录 KnowTrace" })).toBeVisible();

  await page.getByLabel("用户名").fill(username!);
  await page.getByLabel("密码").fill(password!);
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page).toHaveURL(/\/search\?type=capture$/);
  await expect(page.getByText(`@${username}`)).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain("access_token");
  expect(await page.evaluate(() => document.cookie)).not.toContain("refresh_token");

  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok()).toBe(true);
  await expect(session.json()).resolves.toMatchObject({
    ok: true,
    data: {
      enabled: true,
      user: { username },
      authorization: { role_codes: expect.any(Array), permission_codes: expect.any(Array) },
    },
  });

  const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === "refresh_token");
  expect(refreshCookie).toBeDefined();
  await context.clearCookies();
  await context.addCookies([refreshCookie!]);

  await page.goto("/search?type=capture");
  await expect(page).toHaveURL(/\/search\?type=capture$/, { timeout: 15_000 });

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some((cookie) => cookie.name.includes("token"))).toBe(false);

  const protectedImage = await page.request.get("/api/evidence-images/00000000-0000-4000-8000-000000000000");
  expect(protectedImage.status()).toBe(401);
});
