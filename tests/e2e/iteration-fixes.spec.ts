import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { DATA_TRANSFER_FORMAT_VERSION } from "../../src/features/data-transfer/contracts";
import { createPortableWorkbook } from "../../src/features/data-transfer/workbook";

const adminUsername = process.env.AUTH_E2E_ADMIN_USERNAME;
const adminPassword = process.env.AUTH_E2E_ADMIN_PASSWORD;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(adminUsername!);
  await page.getByLabel("密码", { exact: true }).fill(adminPassword!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("manual claim, no-op save and logical import deduplication", async ({ page }) => {
  test.skip(!adminUsername || !adminPassword, "requires the configured administrator account");
  await login(page);
  await expect(page.locator("body")).not.toHaveText("");
  await expect(
    page.locator(
      '[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay',
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "最近记录" })).toBeVisible();
  await page.screenshot({ fullPage: true, path: "test-results/iteration-home.png" });

  const suffix = randomUUID().slice(0, 8);
  const title = `迭代验收 ${suffix}`;
  const content = `每天复盘能够提高问题处理效率。验收标识 ${suffix}`;
  const create = await page.request.post("/api/v1/captures", {
    headers: { "Idempotency-Key": `iteration-${suffix}` },
    data: {
      title,
      subject: "迭代验收对象",
      content,
      occurredAt: "2026-08-24T02:00:00.000Z",
      contentType: "observation",
      categoryIds: [],
    },
  });
  expect(create.status()).toBe(201);
  const created = (await create.json()).data as { id: string; version: number };

  try {
    const unchanged = await page.request.patch(`/api/v1/captures/${created.id}`, {
      data: {
        title: `  ${title}  `,
        subject: " 迭代验收对象 ",
        content,
        occurredAt: "2026-08-24T10:00:00+08:00",
        contentType: "observation",
        expectedVersion: created.version,
      },
    });
    expect(unchanged.status()).toBe(200);
    const unchangedData = (await unchanged.json()).data;
    expect(unchangedData.version).toBe(created.version);
    expect(unchangedData.revisions).toHaveLength(0);

    await page.goto(`/captures/${created.id}`);
    await page.getByLabel("处理引擎").selectOption("openai");
    await page.getByText("高级设置（通常无需修改）").click();
    await page.getByLabel("CC-Switch 地址").fill("http://127.0.0.1:15721/v1");
    await expect(page.getByRole("button", { name: "模型测试（可选）" })).toBeVisible();
    await expect(page.getByRole("button", { name: /开始分析版本/ })).toBeEnabled({
      timeout: 20_000,
    });
    await page.getByPlaceholder("写出一个可以被证据支持或反驳的明确陈述").fill(
      "每天复盘能够提高问题处理效率",
    );
    await page.getByPlaceholder("从上方原文复制一段能够支撑该主张的文字").fill(
      "每天复盘能够提高问题处理效率",
    );
    await expect(page.getByText("已在当前原文中定位")).toBeVisible();
    await page.getByPlaceholder("说明出现什么证据时，这个主张应被反驳或修正").fill(
      "若连续记录显示处理效率没有提升，则应反驳或修正这个主张",
    );
    await page.getByRole("button", { name: "保存为候选主张" }).click();
    await expect(page.locator(".claim-card")).toContainText("每天复盘能够提高问题处理效率");
    await page.screenshot({ fullPage: true, path: "test-results/manual-claim.png" });

    const importedTitle = `重复导入验收 ${suffix}`;
    const portableRecord = {
      title: importedTitle,
      subject: "相同对象",
      content: `相同导入内容 ${suffix}`,
      contentType: "observation" as const,
      occurredAt: "2026-08-20T01:00:00.000Z",
      status: "active" as const,
      categoryKeys: [],
    };
    const firstWorkbook = await createPortableWorkbook({
      formatVersion: DATA_TRANSFER_FORMAT_VERSION,
      records: [{ key: randomUUID(), ...portableRecord }],
      categories: [],
    });
    const secondWorkbook = await createPortableWorkbook({
      formatVersion: DATA_TRANSFER_FORMAT_VERSION,
      records: [{ key: randomUUID(), ...portableRecord }],
      categories: [],
    });

    const preview = await page.request.post("/api/data-transfer/import/preview", {
      multipart: {
        file: {
          name: "first.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: firstWorkbook,
        },
      },
    });
    expect(preview.status()).toBe(200);
    const firstPreview = (await preview.json()).data;
    expect(firstPreview.summary.recordsToCreate).toBe(1);
    const firstConfirm = await page.request.post(
      `/api/data-transfer/import/${firstPreview.runId}/confirm`,
    );
    expect(firstConfirm.status()).toBe(200);

    const duplicatePreviewResponse = await page.request.post(
      "/api/data-transfer/import/preview",
      {
        multipart: {
          file: {
            name: "second.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            buffer: secondWorkbook,
          },
        },
      },
    );
    expect(duplicatePreviewResponse.status()).toBe(200);
    const duplicatePreview = (await duplicatePreviewResponse.json()).data;
    expect(duplicatePreview.summary.recordsToCreate).toBe(0);
    expect(duplicatePreview.summary.recordsToSkip).toBe(1);
    const duplicateConfirm = await page.request.post(
      `/api/data-transfer/import/${duplicatePreview.runId}/confirm`,
    );
    expect(duplicateConfirm.status()).toBe(200);
    expect((await duplicateConfirm.json()).data.result.recordsSkipped).toBe(1);

    const list = await page.request.get("/api/v1/captures?limit=50");
    const imported = ((await list.json()).data as Array<{ id: string; title: string; version: number }>)
      .filter((item) => item.title === importedTitle);
    expect(imported).toHaveLength(1);
    await page.request.delete(`/api/v1/captures/${imported[0].id}`, {
      headers: { "If-Match": `"${imported[0].version}"` },
    });
  } finally {
    await page.request.delete(`/api/v1/captures/${created.id}`, {
      headers: { "If-Match": `"${created.version}"` },
    });
  }
});
