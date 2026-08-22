import { expect, test } from "@playwright/test";

const username = process.env.AUTH_E2E_NEW_USERNAME;
const oldPassword = process.env.AUTH_E2E_NEW_PASSWORD;
const newPassword = process.env.AUTH_E2E_CHANGED_PASSWORD;

test("register, update profile and invalidate all sessions after password change", async ({ page }) => {
  test.skip(!username || !oldPassword || !newPassword, "requires disposable account credentials and enabled registration");

  await page.goto("/register");
  await page.getByRole("textbox", { name: /用户名/ }).fill(username!);
  await page.getByLabel(/^密码/).fill(oldPassword!);
  await page.getByLabel(/确认密码/).fill(oldPassword!);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();

  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await expect(page.getByText("账号已创建，请使用新账号登录。", { exact: true })).toBeVisible();
  await page.getByLabel("用户名").fill(username!);
  await page.getByLabel("密码", { exact: true }).fill(oldPassword!);
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await page.getByRole("link", { name: new RegExp(`@${username}.*账户中心`) }).click();
  await page.getByRole("textbox", { name: /昵称/ }).fill("账户联调用户");
  await page.getByRole("button", { name: "保存昵称" }).click();
  await expect(page).toHaveURL(/\/account\?profile=updated$/);
  await expect(page.getByText("账户联调用户", { exact: true }).first()).toBeVisible();

  await page.locator('input[name="oldPassword"]').fill(oldPassword!);
  await page.locator('input[name="newPassword"]').fill(newPassword!);
  await page.locator('input[name="newPasswordConfirm"]').fill(newPassword!);
  await page.getByRole("button", { name: "修改密码并退出全部会话" }).click();

  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/);
  await expect(page.getByText(/全部会话已退出/)).toBeVisible();

  await page.getByLabel("用户名").fill(username!);
  await page.getByLabel("密码", { exact: true }).fill(oldPassword!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("密码", { exact: true }).fill(newPassword!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(`@${username}`)).toBeVisible();
});
