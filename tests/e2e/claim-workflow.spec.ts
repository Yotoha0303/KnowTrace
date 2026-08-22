import { expect, test } from "@playwright/test";

test("AI candidate claim → evidence review → ready for review", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  const suffix = Date.now().toString().slice(-6);
  const title = `可证伪主张流程 ${suffix}`;
  const statement = "每天复盘能够提高问题处理效率";

  await page.goto("/");
  await page.getByPlaceholder("标题可以稍后再补").fill(title);
  await page.getByPlaceholder(/输入关键词/).fill(`${statement}。`);
  await page.getByRole("button", { name: /保存并整理/ }).click();

  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  await page.getByLabel("处理引擎").selectOption("mock");
  await page.getByRole("button", { name: /开始分析版本/ }).click();

  const candidate = page.locator(".claim-candidate-list label");
  await expect(candidate).toHaveCount(1);
  await expect(candidate).toContainText(statement);
  await expect(candidate.locator("input")).not.toBeChecked();
  await candidate.locator("input").check();
  await page.getByRole("button", { name: /接受当前选择/ }).click();

  const claimCard = page.locator(".claim-card");
  await expect(claimCard).toHaveCount(1);
  await expect(claimCard.getByRole("heading", { name: statement })).toBeVisible();
  await expect(claimCard.locator(".claim-status")).toContainText("候选");
  await claimCard.getByRole("button", { name: /开始调查/ }).click();

  await expect(claimCard.locator(".claim-status")).toContainText("调查中");
  const submitButton = claimCard.getByRole("button", { name: /提交待审核/ });
  await expect(submitButton).toBeDisabled();

  await claimCard.getByLabel(/来源标题/).fill("Example Domain");
  await claimCard.getByLabel(/来源 URL/).fill("https://example.com/");
  await claimCard
    .getByLabel(/证据摘录/)
    .fill("Example Domain");
  await claimCard.getByLabel(/证据立场/).selectOption("supports");
  await claimCard.getByRole("button", { name: /保存为未审核证据/ }).click();

  const evidenceItem = claimCard.locator(".evidence-list > article");
  await expect(evidenceItem.locator(".evidence-review")).toContainText("未审核");
  await expect(evidenceItem.getByText("来源尚未检查")).toBeVisible();
  await evidenceItem.locator('input[type="file"]').setInputFiles({
    name: "evidence.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await evidenceItem.getByRole("button", { name: "上传图片" }).click();
  await expect(evidenceItem.getByRole("img", { name: "evidence.png" })).toBeVisible();
  const imageResponse = await page.request.get(
    await evidenceItem.getByRole("img", { name: "evidence.png" }).getAttribute("src") as string,
  );
  expect(imageResponse.ok()).toBe(true);
  expect(imageResponse.headers()["content-type"]).toBe("image/png");
  expect(imageResponse.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(submitButton).toBeDisabled();
  await expect(evidenceItem.getByRole("button", { name: /采纳/ })).toBeDisabled();
  await evidenceItem.getByRole("button", { name: /^检查来源$/ }).click();
  await expect(evidenceItem.getByText("来源可访问，摘录已匹配")).toBeVisible({
    timeout: 20_000,
  });
  await expect(evidenceItem.getByText(/HTTP 200/)).toBeVisible();
  await evidenceItem.getByRole("button", { name: /编辑/ }).click();
  await evidenceItem.getByLabel("来源标题").fill("Example Domain（修订）");
  await evidenceItem.getByRole("button", { name: /保存修改/ }).click();
  await expect(evidenceItem.getByText("来源尚未检查")).toBeVisible();
  await expect(evidenceItem.getByText("查看 1 个历史版本")).toBeVisible();
  await expect(evidenceItem.getByText("v2")).toBeVisible();
  await expect(evidenceItem.getByRole("button", { name: /采纳/ })).toBeDisabled();
  await evidenceItem.getByRole("button", { name: /^检查来源$/ }).click();
  await expect(evidenceItem.getByText("来源可访问，摘录已匹配")).toBeVisible({
    timeout: 20_000,
  });
  await expect(evidenceItem.getByRole("button", { name: /采纳/ })).toBeEnabled();
  await evidenceItem.getByRole("button", { name: /采纳/ }).click();
  await expect(evidenceItem.locator(".evidence-review")).toContainText("已采纳");
  await expect(evidenceItem.getByRole("button", { name: /编辑/ })).toHaveCount(0);
  await expect(evidenceItem.getByText("选择证据图片")).toHaveCount(0);
  await expect(submitButton).toBeEnabled();

  await page.getByRole("button", { name: /^运行可靠性审查$/ }).click();
  const auditResult = page.locator(".claim-ai-audit-result");
  await expect(auditResult).toContainText("覆盖有限");
  await expect(auditResult).toContainText("证据方向单一");
  await expect(auditResult).toContainText("AI 建议：倾向支持（仅供人工参考）");
  await expect(auditResult).toContainText("不能替代人工判断");

  await submitButton.click();

  await expect(claimCard.locator(".claim-status")).toContainText("待审核");
  await expect(auditResult).toContainText("输入已变化，请重新审查");
  await expect(page.getByText("这里没有“已验证”按钮")).toBeVisible();
  await expect(page.getByRole("button", { name: /退回补充证据/ })).toBeVisible();
  const concludeButton = claimCard.getByRole("button", { name: "保存人工结论" });
  await expect(claimCard.getByText("结论类型（必选）")).toBeVisible();
  await expect(claimCard.getByText("结论依据（必填）")).toBeVisible();
  await expect(claimCard.getByText("限制与未知（选填）")).toBeVisible();
  await expect(claimCard.getByText("还需 10 个字符")).toBeVisible();
  await expect(concludeButton).toBeDisabled();
  await claimCard.getByLabel(/结论类型/).selectOption("supported");
  await expect(claimCard.getByText("需要至少 1 条已采纳的支持证据；当前 1 条。")).toBeVisible();
  await claimCard.getByLabel(/结论依据/).fill("自主审核");
  await expect(claimCard.getByText("还需 6 个字符")).toBeVisible();
  await expect(concludeButton).toBeDisabled();
  await claimCard
    .getByLabel(/结论依据/)
    .fill("来源快照中的摘录与保存内容一致，现有支持证据满足本次最小判断范围。");
  await expect(claimCard.getByText("已满足最少字符要求")).toBeVisible();
  await expect(concludeButton).toBeEnabled();
  await claimCard
    .getByLabel(/结论限制/)
    .fill("该示例来源只用于验证流程，不代表真实研究质量。");
  await concludeButton.click();

  await expect(claimCard.locator(".claim-status")).toContainText("已形成结论");
  await expect(claimCard.getByText("现有证据支持")).toBeVisible();
  await expect(claimCard.getByText("已冻结 1 条证据来源快照")).toBeVisible();
  await expect(claimCard.getByRole("button", { name: /重新调查/ })).toBeVisible();
  await page.screenshot({ fullPage: true, path: "test-results/claim-workflow.png" });

  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "主张库" })).toBeVisible();
  await page.getByLabel("搜索主张").fill("每天复盘");
  await page.getByLabel("主张状态").selectOption("concluded");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page).toHaveURL(/\/claims\?q=.*status=concluded/);
  const claimIndexCard = page.locator(".claim-index-card");
  await expect(claimIndexCard).toHaveCount(1);
  await expect(claimIndexCard).toContainText(statement);
  await expect(claimIndexCard).toContainText("现有证据支持");
  await page.screenshot({ fullPage: true, path: "test-results/claim-index.png" });
  await claimIndexCard.click();
  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+#claims$/);

  await claimCard.getByRole("button", { name: /重新调查/ }).click();
  await expect(claimCard.locator(".claim-status")).toContainText("调查中");
  await expect(claimCard.getByText("现有证据支持")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("image evidence can be manually verified without a source URL", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  const suffix = Date.now().toString().slice(-6);
  const title = `无链接证据 ${suffix}`;
  const statement = "每天复盘能够提高问题处理效率";

  await page.goto("/");
  await page.getByPlaceholder("标题可以稍后再补").fill(title);
  await page.getByPlaceholder(/输入关键词/).fill(`${statement}。`);
  await page.getByRole("button", { name: /保存并整理/ }).click();

  await expect(page).toHaveURL(/\/captures\/[0-9a-f-]+$/);
  await page.getByLabel("处理引擎").selectOption("mock");
  await page.getByRole("button", { name: /开始分析版本/ }).click();

  const candidate = page.locator(".claim-candidate-list label");
  await expect(candidate).toHaveCount(1);
  await candidate.locator("input").check();
  await page.getByRole("button", { name: /接受当前选择/ }).click();

  const claimCard = page.locator(".claim-card");
  await claimCard.getByRole("button", { name: /开始调查/ }).click();
  await claimCard.getByLabel(/来源标题/).fill("微信现场记录");
  await claimCard.getByLabel(/证据摘录/).fill("现场观察到的原始内容");

  const saveButton = claimCard.getByRole("button", { name: /保存为未审核证据/ });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  const evidenceItem = claimCard.locator(".evidence-list > article");
  await expect(evidenceItem).toContainText("微信现场记录");
  await expect(evidenceItem.getByText("未提供来源材料")).toBeVisible();
  await expect(evidenceItem.getByRole("button", { name: /^核对附件$/ })).toBeDisabled();

  await evidenceItem.locator('input[type="file"]').setInputFiles({
    name: "wechat-evidence.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await evidenceItem.getByRole("button", { name: "上传图片" }).click();
  await expect(evidenceItem.getByRole("img", { name: "wechat-evidence.png" })).toBeVisible();
  const originalImageLink = evidenceItem.getByRole("link", { name: /在线查看原图/ });
  await expect(originalImageLink).toBeVisible();
  const imageResponse = await page.request.get(
    await originalImageLink.getAttribute("href") as string,
  );
  expect(imageResponse.ok()).toBe(true);
  expect(imageResponse.headers()["content-type"]).toBe("image/png");
  await expect(evidenceItem.getByText("附件尚未核验")).toBeVisible();

  const verifyAttachmentButton = evidenceItem.getByRole("button", { name: /^核对附件$/ });
  await expect(verifyAttachmentButton).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await verifyAttachmentButton.click();
  await expect(evidenceItem.getByText("附件已人工核验")).toBeVisible();
  await expect(evidenceItem.getByText("已冻结 1 张图片")).toBeVisible();
  await expect(evidenceItem.getByRole("button", { name: /采纳/ })).toBeEnabled();

  await evidenceItem.locator('input[type="file"]').setInputFiles({
    name: "wechat-evidence-followup.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await evidenceItem.getByRole("button", { name: "上传图片" }).click();
  await expect(evidenceItem.getByText("附件尚未核验")).toBeVisible();
  await expect(evidenceItem.getByRole("button", { name: /采纳/ })).toBeDisabled();

  const reverifyAttachmentButton = evidenceItem.getByRole("button", { name: /^核对附件$/ });
  page.once("dialog", (dialog) => dialog.accept());
  await reverifyAttachmentButton.click();
  await expect(evidenceItem.getByText("已冻结 2 张图片")).toBeVisible();
  await expect(evidenceItem.getByRole("button", { name: /采纳/ })).toBeEnabled();
  await evidenceItem.getByRole("button", { name: /采纳/ }).click();

  const submitButton = claimCard.getByRole("button", { name: /提交待审核/ });
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
  await expect(claimCard.locator(".claim-status")).toContainText("待审核");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "永久删除" }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);
  expect(consoleErrors).toEqual([]);
});
