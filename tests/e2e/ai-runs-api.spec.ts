import { expect, test } from "@playwright/test";

const authUsername = process.env.AUTH_E2E_USERNAME;
const authPassword = process.env.AUTH_E2E_PASSWORD;

/**
 * `/api/v1/ai-runs` 的契约测试。
 *
 * 这里**显式指定 `provider: "mock"`**，让测试只验证 API 契约（建 Run、读 Run、
 * 列表、鉴权、404），不依赖网络与模型额度，因此在 CI 中稳定。
 * 真实提供方的行为由 `src/server/ai/provider.integration.test.ts` 覆盖，
 * 那个测试默认跳过、只在提供密钥时执行。
 */
test("versioned AI run API triggers, reads back and scopes a run", async ({ page }) => {
  if (authUsername && authPassword) {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(authUsername);
    await page.getByLabel("密码", { exact: true }).fill(authPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  } else {
    const session = await page.request.get("/api/v1/auth/session");
    test.skip(
      session.status() === 401,
      "authentication is enabled; provide AUTH_E2E_USERNAME and AUTH_E2E_PASSWORD",
    );
  }

  const request = page.request;
  const suffix = Date.now().toString().slice(-8);
  const idempotencyKey = `ai-run-${suffix}`;
  let captureId: string | null = null;

  try {
    // 准备一条真实记录作为 AI 整理的对象。
    const created = await request.post("/api/v1/captures", {
      data: {
        title: `AI API 记录 ${suffix}`,
        subject: `AI API 对象 ${suffix}`,
        content:
          "用户的记录里包含可以通过观察或资料支持或反驳的陈述；也包含目标、偏好这类不应该被提取为主张的内容。",
        occurredAt: new Date().toISOString(),
        contentType: "thought_fragment",
        categoryIds: [],
      },
      headers: { "Idempotency-Key": idempotencyKey },
    });
    expect(created.status()).toBe(201);
    const createdPayload = await created.json();
    captureId = createdPayload.data.id;
    const captureVersion = createdPayload.data.version;

    // 触发一次整理。显式 mock，保证离线可重复。
    const triggered = await request.post("/api/v1/ai-runs", {
      data: {
        captureId,
        expectedCaptureVersion: captureVersion,
        provider: "mock",
      },
    });
    expect(triggered.status()).toBe(201);
    const triggeredPayload = await triggered.json();
    const runId: string = triggeredPayload.data.runId;
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(triggeredPayload.data.suggestionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(triggered.headers().location).toBe(`/api/v1/ai-runs/${runId}`);
    expect(triggered.headers()["cache-control"]).toBe("private, no-store");

    // 读回 Run：状态、用量字段与建议必须齐备。
    const detail = await request.get(`/api/v1/ai-runs/${runId}`);
    expect(detail.status()).toBe(200);
    const detailPayload = await detail.json();
    expect(detailPayload).toMatchObject({
      ok: true,
      meta: { apiVersion: "v1" },
      data: {
        id: runId,
        captureId,
        captureVersion,
        taskType: "organize",
        provider: "mock",
        status: "succeeded",
        errorCode: null,
      },
    });
    expect(typeof detailPayload.data.latencyMs).toBe("number");
    expect(detailPayload.data.completedAt).toBeTruthy();
    expect(detailPayload.data.suggestion).toMatchObject({
      processingRunId: runId,
      captureId,
      status: "pending",
    });
    // 建议内容必须结构化，且语义单元的 source_excerpt 逐字来自原文。
    expect(detailPayload.data.suggestion.payload).toBeTruthy();
    expect(
      Array.isArray(detailPayload.data.suggestion.payload.semantic_units),
    ).toBe(true);

    // 列表能按 captureId 过滤到这条 Run。
    const list = await request.get(`/api/v1/ai-runs?captureId=${captureId}&limit=5`);
    expect(list.status()).toBe(200);
    const listPayload = await list.json();
    expect(listPayload.meta).toMatchObject({ apiVersion: "v1", page: 1, limit: 5 });
    expect(
      listPayload.data.some((row: { id: string }) => row.id === runId),
    ).toBe(true);

    // 状态过滤是合法查询参数；非法状态值必须被拒绝。
    const filtered = await request.get("/api/v1/ai-runs?status=succeeded&limit=1");
    expect(filtered.status()).toBe(200);
    const invalidStatus = await request.get("/api/v1/ai-runs?status=nonsense");
    expect(invalidStatus.status()).toBe(422);
    expect((await invalidStatus.json()).error.code).toBe("VALIDATION_ERROR");

    // 版本冲突必须被拒绝：用已经过期的版本号再次触发。
    const staleTrigger = await request.post("/api/v1/ai-runs", {
      data: {
        captureId,
        expectedCaptureVersion: captureVersion + 99,
        provider: "mock",
      },
    });
    expect(staleTrigger.status()).toBe(409);
    expect((await staleTrigger.json()).error.code).toBe("CAPTURE_VERSION_CONFLICT");

    // 不存在的 Run 与非法 id 都返回同形态 404，不泄露存在性。
    const missing = await request.get(
      "/api/v1/ai-runs/00000000-0000-4000-8000-000000000000",
    );
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("AI_RUN_NOT_FOUND");
    const malformed = await request.get("/api/v1/ai-runs/not-a-uuid");
    expect(malformed.status()).toBe(404);
    expect((await malformed.json()).error.code).toBe("AI_RUN_NOT_FOUND");

    // 缺少必填字段必须返回带 fieldErrors 的 422。
    const invalidBody = await request.post("/api/v1/ai-runs", {
      data: { provider: "mock" },
    });
    expect(invalidBody.status()).toBe(422);
    expect(
      (await invalidBody.json()).error.fieldErrors.captureId,
    ).toHaveLength(1);
  } finally {
    if (captureId) {
      const detail = await request.get(`/api/v1/captures/${captureId}`);
      if (detail.ok()) {
        const version = (await detail.json()).data.version;
        // Run 通过 capture 级联删除，不需要单独清理。
        await request.delete(`/api/v1/captures/${captureId}`, {
          headers: { "If-Match": `"${version}"` },
        });
      }
    }
  }
});
