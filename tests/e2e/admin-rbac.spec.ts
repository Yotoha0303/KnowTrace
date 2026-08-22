import { expect, test } from "@playwright/test";

const adminUsername = process.env.AUTH_E2E_ADMIN_USERNAME;
const adminPassword = process.env.AUTH_E2E_ADMIN_PASSWORD;
const targetUserID = process.env.AUTH_E2E_TARGET_USER_ID;

test("authorized administrator can replace a target user's roles", async ({ page }) => {
  test.skip(!adminUsername || !adminPassword || !targetUserID, "requires disposable admin and target accounts");

  await page.goto("/login");
  await page.getByLabel("用户名").fill(adminUsername!);
  await page.getByLabel("密码", { exact: true }).fill(adminPassword!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");

  await expect(page.getByRole("heading", { name: "管理员：分配角色" })).toBeVisible();
  await page.getByRole("spinbutton", { name: /目标用户 ID/ }).fill(targetUserID!);
  await page.locator('input[name="roleCodes"][value="user"]').check();
  await page.locator('input[name="roleCodes"][value="admin"]').check();
  await page.getByRole("checkbox", { name: /我已确认/ }).check();
  await page.getByRole("button", { name: "保存角色分配" }).click();

  await expect(page.getByText(`已更新用户 #${targetUserID} 的角色。新的权限会在其下一次请求时生效。`)).toBeVisible();
});
