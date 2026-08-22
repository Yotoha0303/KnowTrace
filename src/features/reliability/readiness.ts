import type { SourceAuthorityLevel } from "./schema";

export type ReliabilityInput = {
  authenticated: boolean;
  claimStatus: string;
  review: null | { id: string; reviewerId: string };
  evidence: Array<{
    id: string;
    currentReviewStatus: string;
    currentSourceCheckStatus: string;
    currentExcerptMatch: boolean | null;
    currentSourceCheckId: string | null;
    snapshotSourceCheckId: string;
    finalUrl: string;
    authority: null | { level: SourceAuthorityLevel; publisher: string };
  }>;
  independentReviews: Array<{
    decision: "approved" | "changes_requested";
    reviewerId: string;
    isStale: boolean;
  }>;
};

export type ReadinessCheck = {
  code: string;
  label: string;
  passed: boolean;
};

const strongAuthorityLevels = new Set<SourceAuthorityLevel>([
  "primary",
  "official",
  "expert",
]);

export function sourceIdentity(input: {
  id: string;
  finalUrl: string;
  authority: null | { publisher: string };
}): string {
  try {
    const url = new URL(input.finalUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `web:${url.hostname.toLowerCase().replace(/^www\./, "")}`;
    }
  } catch {
    // Attachment snapshots use an application URL rather than HTTP.
  }
  const publisher = input.authority?.publisher.trim().toLocaleLowerCase("zh-CN");
  return publisher ? `offline:${publisher}` : `offline-evidence:${input.id}`;
}

export function evaluateReleaseReadiness(input: ReliabilityInput): ReadinessCheck[] {
  const evidenceCurrent = input.evidence.every(
    (item) =>
      item.currentReviewStatus === "accepted" &&
      item.currentSourceCheckStatus === "passed" &&
      item.currentExcerptMatch === true &&
      item.currentSourceCheckId === item.snapshotSourceCheckId,
  );
  const allAuthorityAssessed = input.evidence.every(
    (item) => item.authority && item.authority.level !== "unknown",
  );
  const strongAuthority = input.evidence.some(
    (item) => item.authority && strongAuthorityLevels.has(item.authority.level),
  );
  const identities = new Set(input.evidence.map(sourceIdentity));
  const independentApprovals = input.independentReviews.filter(
    (item) =>
      item.decision === "approved" &&
      !item.isStale &&
      item.reviewerId !== input.review?.reviewerId,
  );
  const unresolvedChanges = input.independentReviews.some(
    (item) => item.decision === "changes_requested" && !item.isStale,
  );

  return [
    {
      code: "authenticated",
      label: "已启用 go-user-system，并能识别当前发布者",
      passed: input.authenticated,
    },
    {
      code: "concluded",
      label: "主张处于已形成结论状态，且存在当前人工结论",
      passed: input.claimStatus === "concluded" && Boolean(input.review),
    },
    {
      code: "evidence_count",
      label: "当前结论至少冻结 2 条证据快照",
      passed: input.evidence.length >= 2,
    },
    {
      code: "evidence_current",
      label: "全部证据仍为已采纳、来源检查通过且哈希快照未变化",
      passed: input.evidence.length > 0 && evidenceCurrent,
    },
    {
      code: "authority",
      label: "每条证据都有当前版本的来源权威性评估",
      passed: input.evidence.length > 0 && allAuthorityAssessed,
    },
    {
      code: "strong_authority",
      label: "至少一条来源被评为第一手、官方或专业来源",
      passed: strongAuthority,
    },
    {
      code: "independent_sources",
      label: "证据来自至少 2 个独立站点或线下发布主体",
      passed: identities.size >= 2,
    },
    {
      code: "independent_review",
      label: "不同于结论作者的登录用户已批准独立复核，且没有未解决的修改要求",
      passed: independentApprovals.length > 0 && !unresolvedChanges,
    },
  ];
}
