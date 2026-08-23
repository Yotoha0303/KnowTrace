import { expect, test } from "@playwright/test";

const authUsername = process.env.AUTH_E2E_USERNAME;
const authPassword = process.env.AUTH_E2E_PASSWORD;

test("versioned API supports a conflict-safe mobile capture lifecycle", async ({
  page,
}) => {
  if (authUsername && authPassword) {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(authUsername);
    await page.getByLabel("密码", { exact: true }).fill(authPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  } else {
    const session = await page.request.get("/api/v1/auth/session");
    test.skip(session.status() === 401, "authentication is enabled; provide AUTH_E2E_USERNAME and AUTH_E2E_PASSWORD");
  }
  const request = page.request;
  const suffix = Date.now().toString().slice(-8);
  const title = `移动 API 记录 ${suffix}`;
  const subject = `移动 API 对象 ${suffix}`;
  const idempotencyKey = `mobile-api-${suffix}`;
  const initial = {
    title,
    subject,
    content: "通过版本化 API 创建的一条散碎记录。",
    occurredAt: new Date().toISOString(),
    contentType: "thought_fragment",
    categoryIds: [],
  };
  let captureId: string | null = null;

  try {
    const missingKey = await request.post("/api/v1/captures", { data: initial });
    expect(missingKey.status()).toBe(422);
    expect((await missingKey.json()).error.fieldErrors.idempotencyKey).toHaveLength(1);

    const created = await request.post("/api/v1/captures", {
      data: initial,
      headers: { "Idempotency-Key": idempotencyKey },
    });
    expect(created.status()).toBe(201);
    expect(created.headers()["cache-control"]).toBe("private, no-store");
    const createdPayload = await created.json();
    captureId = createdPayload.data.id;
    expect(createdPayload).toMatchObject({
      ok: true,
      data: { version: 1 },
      meta: { apiVersion: "v1" },
    });
    expect(created.headers().location).toBe(`/api/v1/captures/${captureId}`);

    const duplicate = await request.post("/api/v1/captures", {
      data: initial,
      headers: { "Idempotency-Key": idempotencyKey },
    });
    expect(duplicate.status()).toBe(201);
    expect((await duplicate.json()).data.id).toBe(captureId);

    const list = await request.get("/api/v1/captures?limit=1", {
      headers: { "X-Request-Id": `api-test-${suffix}` },
    });
    expect(list.status()).toBe(200);
    expect(list.headers()["x-request-id"]).toBe(`api-test-${suffix}`);
    expect(await list.json()).toMatchObject({
      ok: true,
      meta: { apiVersion: "v1", page: 1, limit: 1 },
    });

    const invalidPage = await request.get("/api/v1/captures?limit=999");
    expect(invalidPage.status()).toBe(422);
    expect((await invalidPage.json()).error.code).toBe("VALIDATION_ERROR");

    const detail = await request.get(`/api/v1/captures/${captureId}`);
    expect(detail.status()).toBe(200);
    expect(detail.headers().etag).toBe('"1"');
    expect(await detail.json()).toMatchObject({
      data: { id: captureId, title, subject, version: 1 },
    });

    const updatedContent = `${initial.content}\n补充移动端修改。`;
    const updated = await request.patch(`/api/v1/captures/${captureId}`, {
      data: {
        title,
        subject,
        content: updatedContent,
        occurredAt: initial.occurredAt,
        contentType: initial.contentType,
        expectedVersion: 1,
      },
    });
    expect(updated.status()).toBe(200);
    expect(updated.headers().etag).toBe('"2"');
    expect(await updated.json()).toMatchObject({
      data: { id: captureId, content: updatedContent, version: 2 },
    });

    const staleUpdate = await request.patch(`/api/v1/captures/${captureId}`, {
      data: {
        ...initial,
        categoryIds: undefined,
        expectedVersion: 1,
      },
    });
    expect(staleUpdate.status()).toBe(409);
    expect(await staleUpdate.json()).toMatchObject({
      error: {
        code: "CAPTURE_VERSION_CONFLICT",
        details: { currentVersion: 2 },
      },
    });

    const subjects = await request.get("/api/v1/subjects");
    expect((await subjects.json()).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: subject })]),
    );
    const timeline = await request.get(
      `/api/v1/subjects/${encodeURIComponent(subject)}`,
    );
    expect(await timeline.json()).toMatchObject({
      data: { subject, captures: [expect.objectContaining({ id: captureId })] },
    });

    for (const endpoint of [
      "/api/v1/categories",
      "/api/v1/claims?limit=1",
      "/api/v1/knowledge-releases?limit=1",
    ]) {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(200);
      expect(Array.isArray((await response.json()).data)).toBe(true);
    }

    const unsafeDelete = await request.delete(`/api/v1/captures/${captureId}`);
    expect(unsafeDelete.status()).toBe(428);
    expect((await unsafeDelete.json()).error.code).toBe("PRECONDITION_REQUIRED");

    const staleDelete = await request.delete(`/api/v1/captures/${captureId}`, {
      headers: { "If-Match": "1" },
    });
    expect(staleDelete.status()).toBe(409);

    const deleted = await request.delete(`/api/v1/captures/${captureId}`, {
      headers: { "If-Match": '"2"' },
    });
    expect(deleted.status()).toBe(200);
    captureId = null;

    const missing = await request.get(`/api/v1/captures/${createdPayload.data.id}`);
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("CAPTURE_NOT_FOUND");
  } finally {
    if (captureId) {
      const detail = await request.get(`/api/v1/captures/${captureId}`);
      if (detail.ok()) {
        const version = (await detail.json()).data.version;
        await request.delete(`/api/v1/captures/${captureId}`, {
          headers: { "If-Match": `"${version}"` },
        });
      }
    }
  }
});
