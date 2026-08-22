import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const username = process.env.AUTH_E2E_USERNAME;
const password = process.env.AUTH_E2E_PASSWORD;
const runReliableRelease = process.env.RELIABLE_RELEASE_E2E === "true";

test("identified independent reviewer can freeze a reliable knowledge release", async ({ page }) => {
  test.skip(
    !runReliableRelease || !username || !password,
    "requires go-user-system auth and the reliable-release integration fixture",
  );

  const sql = postgres(
    process.env.DATABASE_URL ?? "postgres://knowtrace:knowtrace@localhost:15432/knowtrace",
    { max: 1 },
  );
  const captureId = randomUUID();
  const claimId = randomUUID();
  const reviewId = randomUUID();
  const evidenceIds = [randomUUID(), randomUUID()];
  const checkIds = [randomUUID(), randomUUID()];
  const suffix = Date.now().toString().slice(-6);

  try {
    await sql`
      INSERT INTO captures (
        id, title, content, content_type, status, version,
        idempotency_key, idempotency_hash, occurred_at
      ) VALUES (
        ${captureId}, ${`可靠发布集成 ${suffix}`}, '可靠发布集成测试材料。',
        'observation', 'active', 1, ${`reliable-release-${suffix}`}, ${"a".repeat(64)}, now()
      )
    `;
    await sql`
      INSERT INTO claims (
        id, capture_id, source_capture_version, statement, statement_hash,
        source_excerpt, falsification_criteria, status
      ) VALUES (
        ${claimId}, ${captureId}, 1, '两类独立来源共同支持该集成测试主张', ${"b".repeat(58) + suffix},
        '可靠发布集成测试材料', '任一来源快照失效或独立复核拒绝时不得发布', 'concluded'
      )
    `;
    for (let index = 0; index < evidenceIds.length; index += 1) {
      await sql`
        INSERT INTO claim_evidence (
          id, claim_id, source_url, source_title, excerpt, stance, version,
          review_status, source_check_status
        ) VALUES (
          ${evidenceIds[index]}, ${claimId},
          ${index === 0 ? "https://official.example/report" : "https://research.example/paper"},
          ${index === 0 ? "官方报告" : "专业研究"}, '可回链的证据摘录', 'supports', 1,
          'unreviewed', 'unchecked'
        )
      `;
      await sql`
        INSERT INTO evidence_source_checks (
          id, evidence_id, verification_method, requested_url, final_url, status,
          http_status, content_type, content_hash, fetched_title, excerpt_match,
          response_bytes, checked_at
        ) VALUES (
          ${checkIds[index]}, ${evidenceIds[index]}, 'web',
          ${index === 0 ? "https://official.example/report" : "https://research.example/paper"},
          ${index === 0 ? "https://official.example/report" : "https://research.example/paper"},
          'passed', 200, 'text/html', ${String(index + 1).repeat(64)},
          ${index === 0 ? "官方报告" : "专业研究"}, true, 1024, now()
        )
      `;
      await sql`
        UPDATE claim_evidence
        SET review_status = 'accepted', reviewed_at = now(),
            source_check_status = 'passed', source_excerpt_match = true,
            source_checked_at = now(), latest_source_check_id = ${checkIds[index]}
        WHERE id = ${evidenceIds[index]}
      `;
    }
    await sql`
      INSERT INTO claim_reviews (
        id, claim_id, review_number, assessment, rationale, limitations,
        reviewer_id, reviewer_name
      ) VALUES (
        ${reviewId}, ${claimId}, 1, 'supported',
        '两条来源快照支持当前有界结论，且保留可证伪条件。',
        '仅用于验证可靠发布状态机。', 'go-user:999999', '结论作者 A'
      )
    `;
    for (let index = 0; index < evidenceIds.length; index += 1) {
      await sql`
        INSERT INTO claim_review_evidence (
          review_id, evidence_id, source_check_id, stance, source_url,
          source_title, excerpt, final_url, source_content_hash, source_checked_at
        ) VALUES (
          ${reviewId}, ${evidenceIds[index]}, ${checkIds[index]}, 'supports',
          ${index === 0 ? "https://official.example/report" : "https://research.example/paper"},
          ${index === 0 ? "官方报告" : "专业研究"}, '可回链的证据摘录',
          ${index === 0 ? "https://official.example/report" : "https://research.example/paper"},
          ${String(index + 1).repeat(64)}, now()
        )
      `;
    }

    await page.goto(`/claims/${claimId}/reliability`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("用户名").fill(username!);
    await page.getByLabel("密码").fill(password!);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/claims/${claimId}/reliability$`));

    const authorityCards = page.locator(".authority-card");
    await expect(authorityCards).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const card = authorityCards.nth(index);
      await card.getByLabel("来源层级（必填）").selectOption(index === 0 ? "official" : "expert");
      await card.getByLabel(/发布主体/).fill(index === 0 ? "官方机构 A" : "研究机构 B");
      await card.getByLabel(/权威性依据/).fill("该来源具有明确发布主体、可追溯快照和本次判断所需的专业责任边界。");
      await card.getByRole("button", { name: "保存评估" }).click();
      await expect(card.getByText(/已保存当前证据版本/)).toBeVisible();
    }

    await page.getByLabel("复核决定（必填）").selectOption("approved");
    await page.getByLabel(/复核依据/).fill("已独立检查证伪条件、两类来源身份、来源层级、证据哈希和当前结论范围，同意发布该有界版本。");
    await page.getByRole("button", { name: "保存独立复核" }).click();
    await expect(page.getByText(/独立复核已保存/)).toBeVisible();
    const releaseButton = page.getByRole("button", { name: "冻结并发布可靠知识版本" });
    await expect(releaseButton).toBeEnabled();
    await releaseButton.click();
    await expect(page.getByText("可靠知识 v1", { exact: true })).toBeVisible();
    await expect(page.locator(".release-checklist .is-passed")).toHaveCount(8);
    await page.screenshot({ fullPage: true, path: "test-results/reliable-release.png" });

    const firstAuthority = authorityCards.first();
    await firstAuthority.getByLabel(/权威性依据/).fill("发布后更新了来源权威性说明；旧独立复核必须失效，不能直接沿用来发布新快照。");
    await firstAuthority.getByRole("button", { name: "更新评估" }).click();
    await expect(page.getByText(/批准发布 · 输入已变化/)).toBeVisible();
    await expect(releaseButton).toBeDisabled();
    await expect(page.getByText("可靠知识 v1", { exact: true })).toBeVisible();
  } finally {
    await sql`DELETE FROM captures WHERE id = ${captureId}`;
    const releaseRows = await sql`
      SELECT id FROM knowledge_releases WHERE claim_id = ${claimId}
    `;
    expect(releaseRows).toHaveLength(0);
    await sql.end();
  }
});
