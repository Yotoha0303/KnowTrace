import { expect, test } from "@playwright/test";

const username = process.env.AUTH_E2E_USERNAME;
const password = process.env.AUTH_E2E_PASSWORD;

test("authenticated user can inspect the go-user-system account center", async ({ page }) => {
  test.skip(!username || !password, "requires a running go-user-system test account");

  await page.goto("/login");
  await page.getByLabel("用户名").fill(username!);
  await page.getByLabel("密码", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await page.getByRole("link", { name: new RegExp(`@${username}.*账户中心`) }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "账户中心" })).toBeVisible();
  await expect(page.getByText(`@${username}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的角色与权限" })).toBeVisible();
  await expect(page.getByText("profile:read", { exact: true })).toBeVisible();
  await expect(page.getByText(/设备会话列表或按设备撤销接口/)).toBeVisible();
});
