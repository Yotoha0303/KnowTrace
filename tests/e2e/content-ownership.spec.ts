import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const adminUsername = process.env.AUTH_E2E_ADMIN_USERNAME;
const adminPassword = process.env.AUTH_E2E_ADMIN_PASSWORD;
const memberUsername = process.env.AUTH_E2E_MEMBER_USERNAME;
const memberPassword = process.env.AUTH_E2E_MEMBER_PASSWORD;

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createCapture(context: BrowserContext, marker: string) {
  const response = await context.request.post("/api/v1/captures", {
    headers: { "Idempotency-Key": `ownership-${marker}-${crypto.randomUUID()}` },
    data: {
      title: `ownership-${marker}`,
      subject: "权限隔离端到端测试",
      content: `temporary ownership record ${marker}`,
      occurredAt: new Date().toISOString(),
      contentType: "observation",
      categoryIds: [],
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; version: number };
}

test("administrator content is shared read-only while member content stays private", async ({ browser }) => {
  test.skip(
    !adminUsername || !adminPassword || !memberUsername || !memberPassword,
    "requires separate administrator and member credentials",
  );

  const adminContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  let adminCapture: { id: string; version: number } | null = null;
  let memberCapture: { id: string; version: number } | null = null;

  try {
    await login(adminPage, adminUsername!, adminPassword!);
    await login(memberPage, memberUsername!, memberPassword!);

    const memberSession = await memberContext.request.get("/api/v1/auth/session");
    expect((await memberSession.json()).data.authorization.role_codes).not.toContain("admin");

    adminCapture = await createCapture(adminContext, "admin");
    memberCapture = await createCapture(memberContext, "member");

    const memberList = await memberContext.request.get("/api/v1/captures?limit=50");
    const memberItems = (await memberList.json()).data as Array<{ id: string }>;
    expect(memberItems.map(({ id }) => id)).toContain(memberCapture.id);
    expect(memberItems.map(({ id }) => id)).toContain(adminCapture.id);

    const memberReadsAdmin = await memberContext.request.get(`/api/v1/captures/${adminCapture.id}`);
    expect(memberReadsAdmin.status()).toBe(200);
    expect((await memberReadsAdmin.json()).data.visibility).toBe("shared");

    const memberWritesAdmin = await memberContext.request.patch(
      `/api/v1/captures/${adminCapture.id}`,
      {
        data: {
          title: "member must not edit shared admin content",
          subject: "权限隔离端到端测试",
          content: "unauthorized change",
          occurredAt: new Date().toISOString(),
          contentType: "observation",
          expectedVersion: adminCapture.version,
        },
      },
    );
    expect(memberWritesAdmin.status()).toBe(404);

    const adminReadsMember = await adminContext.request.get(`/api/v1/captures/${memberCapture.id}`);
    expect(adminReadsMember.status()).toBe(200);
    expect((await adminReadsMember.json()).data.createdByName).toBeTruthy();
  } finally {
    for (const capture of [adminCapture, memberCapture]) {
      if (capture) {
        await adminContext.request.delete(`/api/v1/captures/${capture.id}`, {
          headers: { "If-Match": `"${capture.version}"` },
        });
      }
    }
    await adminContext.close();
    await memberContext.close();
  }
});
