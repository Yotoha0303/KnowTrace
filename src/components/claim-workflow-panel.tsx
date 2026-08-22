"use client";

import { useState, useTransition } from "react";
import {
  ArrowLeftRight,
  Check,
  CircleDot,
  ExternalLink,
  FileSearch,
  Fingerprint,
  FlaskConical,
  LoaderCircle,
  Plus,
  RefreshCw,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  addClaimEvidenceAction,
  checkClaimEvidenceSourceAction,
  concludeClaimAction,
  reviewClaimEvidenceAction,
  transitionClaimAction,
} from "@/app/actions";
import type { ClaimDTO } from "@/features/capture/queries";

const statusLabels = {
  candidate: "候选",
  investigating: "调查中",
  ready_for_review: "待审核",
  concluded: "已形成结论",
  withdrawn: "已撤回",
} as const;

const assessmentLabels = {
  supported: "现有证据支持",
  refuted: "现有证据反驳",
  inconclusive: "证据不足",
} as const;

const stanceLabels = {
  supports: "支持",
  contradicts: "反驳",
  context: "背景",
} as const;

const evidenceStatusLabels = {
  unreviewed: "未审核",
  accepted: "已采纳",
  rejected: "已排除",
} as const;

const sourceErrorLabels: Record<string, string> = {
  EVIDENCE_SOURCE_CHARSET_UNSUPPORTED: "来源字符编码暂不支持",
  EVIDENCE_SOURCE_CONTENT_TYPE_BLOCKED: "来源不是 HTML 或纯文本",
  EVIDENCE_SOURCE_CREDENTIALS_BLOCKED: "来源 URL 包含凭据",
  EVIDENCE_SOURCE_DNS_FAILED: "无法解析来源域名",
  EVIDENCE_SOURCE_HTTP_STATUS: "来源返回非成功状态",
  EVIDENCE_SOURCE_PORT_BLOCKED: "来源使用了非常规端口",
  EVIDENCE_SOURCE_PRIVATE_ADDRESS: "来源指向内部或保留网络",
  EVIDENCE_SOURCE_PROTOCOL_BLOCKED: "来源协议不受支持",
  EVIDENCE_SOURCE_REDIRECT_INVALID: "来源重定向无效",
  EVIDENCE_SOURCE_REDIRECT_LIMIT: "来源重定向次数过多",
  EVIDENCE_SOURCE_TIMEOUT: "来源检查超时",
  EVIDENCE_SOURCE_TOO_LARGE: "来源内容超过 1 MB",
  EVIDENCE_SOURCE_UNAVAILABLE: "来源暂时无法访问",
  EVIDENCE_SOURCE_URL_INVALID: "来源 URL 无效",
};

const checkTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

type EvidenceDTO = ClaimDTO["evidence"][number];

function EvidenceSourceResult({ evidence }: { evidence: EvidenceDTO }) {
  const sourceCheck = evidence.sourceCheck;
  if (!sourceCheck) {
    return (
      <div className="evidence-source-result is-unchecked">
        <ShieldAlert size={16} />
        <div><strong>来源尚未检查</strong><p>采纳前需要确认页面可访问，并核对摘录确实存在。</p></div>
      </div>
    );
  }

  if (sourceCheck.status === "failed") {
    return (
      <div className="evidence-source-result is-failed">
        <ShieldAlert size={16} />
        <div>
          <strong>来源检查失败</strong>
          <p>{sourceErrorLabels[sourceCheck.errorCode ?? ""] ?? "来源无法安全检查"} · {checkTimeFormatter.format(new Date(sourceCheck.checkedAt))}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`evidence-source-result ${sourceCheck.excerptMatch ? "is-matched" : "is-mismatched"}`}>
      {sourceCheck.excerptMatch ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
      <div>
        <strong>{sourceCheck.excerptMatch ? "来源可访问，摘录已匹配" : "来源可访问，但未找到摘录"}</strong>
        <p>
          HTTP {sourceCheck.httpStatus} · {sourceCheck.contentType} · {sourceCheck.responseBytes?.toLocaleString()} B
          {sourceCheck.contentHash ? <> · <Fingerprint size={11} /> {sourceCheck.contentHash.slice(0, 12)}…</> : null}
        </p>
        {sourceCheck.fetchedTitle ? <small>页面标题：{sourceCheck.fetchedTitle}</small> : null}
        <small>检查时间：{checkTimeFormatter.format(new Date(sourceCheck.checkedAt))}</small>
      </div>
    </div>
  );
}

function ClaimCard({ claim }: { claim: ClaimDTO }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [checkingEvidenceId, setCheckingEvidenceId] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [stance, setStance] = useState<"supports" | "contradicts" | "context">("supports");
  const [note, setNote] = useState("");
  const [assessment, setAssessment] = useState<
    "supported" | "refuted" | "inconclusive"
  >("inconclusive");
  const [rationale, setRationale] = useState("");
  const [limitations, setLimitations] = useState("");
  const acceptedEvidenceCount = claim.evidence.filter(
    (evidence) => evidence.reviewStatus === "accepted",
  ).length;

  function transition(targetStatus: ClaimDTO["status"]) {
    setMessage("");
    startTransition(async () => {
      const result = await transitionClaimAction({
        claimId: claim.id,
        expectedStatus: claim.status,
        targetStatus,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function addEvidence() {
    setMessage("");
    startTransition(async () => {
      const result = await addClaimEvidenceAction({
        claimId: claim.id,
        sourceUrl,
        sourceTitle,
        excerpt,
        stance,
        note: note || undefined,
      });
      if (!result.ok) {
        setMessage(
          result.error.fieldErrors
            ? Object.values(result.error.fieldErrors).flat()[0]
            : result.error.message,
        );
        return;
      }
      setSourceUrl("");
      setSourceTitle("");
      setExcerpt("");
      setNote("");
      router.refresh();
    });
  }

  function reviewEvidence(
    evidenceId: string,
    decision: "accepted" | "rejected",
  ) {
    setMessage("");
    startTransition(async () => {
      const result = await reviewClaimEvidenceAction({ evidenceId, decision });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function checkEvidenceSource(evidenceId: string) {
    setMessage("");
    setCheckingEvidenceId(evidenceId);
    startTransition(async () => {
      const result = await checkClaimEvidenceSourceAction({ evidenceId });
      if (!result.ok) {
        setMessage(result.error.message);
        setCheckingEvidenceId(null);
        return;
      }
      setCheckingEvidenceId(null);
      router.refresh();
    });
  }

  function conclude() {
    setMessage("");
    startTransition(async () => {
      const result = await concludeClaimAction({
        claimId: claim.id,
        assessment,
        rationale,
        limitations: limitations || undefined,
      });
      if (!result.ok) {
        setMessage(
          result.error.fieldErrors
            ? Object.values(result.error.fieldErrors).flat()[0]
            : result.error.message,
        );
        return;
      }
      setRationale("");
      setLimitations("");
      router.refresh();
    });
  }

  const latestReview = claim.reviews[0] ?? null;

  return (
    <article className={`claim-card is-${claim.status}`}>
      <header>
        <span className="claim-status"><CircleDot size={13} /> {statusLabels[claim.status]}</span>
        <small>来源版本 v{claim.sourceCaptureVersion}</small>
      </header>
      <h3>{claim.statement}</h3>
      <blockquote>原文：“{claim.sourceExcerpt}”</blockquote>
      <div className="falsification-box">
        <FlaskConical size={16} />
        <p><strong>证伪条件</strong>{claim.falsificationCriteria}</p>
      </div>

      {claim.status === "candidate" ? (
        <div className="claim-actions">
          <button className="button button-primary" disabled={isPending} onClick={() => transition("investigating")} type="button"><FileSearch size={15} /> 开始调查</button>
          <button className="button button-quiet" disabled={isPending} onClick={() => transition("withdrawn")} type="button"><X size={15} /> 撤回</button>
        </div>
      ) : null}

      {claim.status === "investigating" ? (
        <>
          <div className="evidence-summary">
            <span>{claim.evidence.length} 条证据</span>
            <span>{acceptedEvidenceCount} 条已采纳</span>
          </div>
          <div className="evidence-form">
            <h4><Plus size={14} /> 添加证据</h4>
            <div className="evidence-form-grid">
              <label><span>来源标题</span><input aria-label={`${claim.statement} 来源标题`} maxLength={300} onChange={(event) => setSourceTitle(event.target.value)} value={sourceTitle} /></label>
              <label><span>来源 URL</span><input aria-label={`${claim.statement} 来源 URL`} maxLength={2000} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" type="url" value={sourceUrl} /></label>
              <label className="wide"><span>证据原文摘录</span><textarea aria-label={`${claim.statement} 证据摘录`} maxLength={2000} onChange={(event) => setExcerpt(event.target.value)} rows={3} value={excerpt} /></label>
              <label><span>与主张的关系</span><select aria-label={`${claim.statement} 证据立场`} onChange={(event) => setStance(event.target.value as typeof stance)} value={stance}><option value="supports">支持</option><option value="contradicts">反驳</option><option value="context">仅提供背景</option></select></label>
              <label><span>备注（可选）</span><input aria-label={`${claim.statement} 证据备注`} maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} /></label>
            </div>
            <button className="button button-quiet" disabled={isPending || !sourceTitle.trim() || !sourceUrl.trim() || !excerpt.trim()} onClick={addEvidence} type="button"><Plus size={15} /> 保存为未审核证据</button>
          </div>
        </>
      ) : null}

      {claim.evidence.length ? (
        <div className="evidence-list">
          {claim.evidence.map((evidence) => (
            <article key={evidence.id}>
              <header>
                <span className={`evidence-stance is-${evidence.stance}`}>{stanceLabels[evidence.stance]}</span>
                <span className={`evidence-review is-${evidence.reviewStatus}`}>{evidenceStatusLabels[evidence.reviewStatus]}</span>
              </header>
              <a href={evidence.sourceUrl} rel="noreferrer" target="_blank">{evidence.sourceTitle} <ExternalLink size={12} /></a>
              <blockquote>“{evidence.excerpt}”</blockquote>
              {evidence.note ? <p>{evidence.note}</p> : null}
              <EvidenceSourceResult evidence={evidence} />
              {claim.status === "investigating" && evidence.reviewStatus === "unreviewed" ? (
                <div className="evidence-review-actions">
                  <button className="button button-quiet" disabled={isPending} onClick={() => checkEvidenceSource(evidence.id)} type="button">
                    {checkingEvidenceId === evidence.id ? <LoaderCircle className="processing-spinner" size={14} /> : evidence.sourceCheck ? <RefreshCw size={14} /> : <ShieldCheck size={14} />}
                    {checkingEvidenceId === evidence.id ? "正在检查来源" : evidence.sourceCheck ? "重新检查来源" : "检查来源"}
                  </button>
                  <button className="button button-quiet" disabled={isPending} onClick={() => reviewEvidence(evidence.id, "rejected")} type="button"><X size={14} /> 排除</button>
                  <button className="button button-primary" disabled={isPending || evidence.sourceCheckStatus !== "passed" || evidence.sourceExcerptMatch !== true} onClick={() => reviewEvidence(evidence.id, "accepted")} type="button"><Check size={14} /> 采纳</button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {claim.status === "investigating" ? (
        <div className="claim-actions">
          <button className="button button-primary" disabled={isPending || acceptedEvidenceCount === 0} onClick={() => transition("ready_for_review")} type="button"><Send size={15} /> 提交待审核</button>
          <button className="button button-quiet" disabled={isPending} onClick={() => transition("withdrawn")} type="button"><X size={15} /> 撤回</button>
        </div>
      ) : null}

      {claim.status === "ready_for_review" ? (
        <>
          <div className="claim-review-form">
            <h4><Scale size={15} /> 形成人工结论</h4>
            <p>结论必须说明现有证据能支持到什么程度。它会冻结本次使用的证据与来源哈希，但不会变成“永远正确”。</p>
            <label>
              <span>结论类型</span>
              <select aria-label={`${claim.statement} 结论类型`} onChange={(event) => setAssessment(event.target.value as typeof assessment)} value={assessment}>
                <option value="inconclusive">证据不足</option>
                <option value="supported">现有证据支持</option>
                <option value="refuted">现有证据反驳</option>
              </select>
            </label>
            <label>
              <span>结论依据</span>
              <textarea aria-label={`${claim.statement} 结论依据`} maxLength={2000} onChange={(event) => setRationale(event.target.value)} placeholder="说明采纳了哪些证据、为什么得到这个结论……" rows={4} value={rationale} />
            </label>
            <label>
              <span>限制与未知（可选）</span>
              <textarea aria-label={`${claim.statement} 结论限制`} maxLength={2000} onChange={(event) => setLimitations(event.target.value)} placeholder="样本范围、时间边界、仍存在的反例……" rows={3} value={limitations} />
            </label>
            <button className="button button-primary" disabled={isPending || rationale.trim().length < 10} onClick={conclude} type="button"><Check size={15} /> 保存人工结论</button>
          </div>
          <div className="claim-actions">
            <button className="button button-quiet" disabled={isPending} onClick={() => transition("investigating")} type="button"><ArrowLeftRight size={15} /> 退回补充证据</button>
            <button className="button button-quiet" disabled={isPending} onClick={() => transition("withdrawn")} type="button"><X size={15} /> 撤回</button>
          </div>
        </>
      ) : null}

      {latestReview ? (
        <div className={`claim-conclusion is-${latestReview.assessment}`}>
          <header><span>{assessmentLabels[latestReview.assessment]}</span><small>结论 v{latestReview.reviewNumber} · {checkTimeFormatter.format(new Date(latestReview.createdAt))}</small></header>
          <p><strong>依据</strong>{latestReview.rationale}</p>
          {latestReview.limitations ? <p><strong>限制</strong>{latestReview.limitations}</p> : null}
          <small>已冻结 {latestReview.evidenceSnapshots.length} 条证据来源快照</small>
          {claim.reviews.length > 1 ? (
            <details>
              <summary>查看全部 {claim.reviews.length} 次结论</summary>
              {claim.reviews.map((review) => (
                <div key={review.id}><b>v{review.reviewNumber} · {assessmentLabels[review.assessment]}</b><p>{review.rationale}</p></div>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}

      {claim.status === "concluded" ? (
        <div className="claim-actions">
          <button className="button button-quiet" disabled={isPending} onClick={() => transition("investigating")} type="button"><ArrowLeftRight size={15} /> 重新调查</button>
          <button className="button button-quiet" disabled={isPending} onClick={() => transition("withdrawn")} type="button"><X size={15} /> 撤回</button>
        </div>
      ) : null}
      {message ? <p className="form-error claim-message">{message}</p> : null}
    </article>
  );
}

export function ClaimWorkflowPanel({ claims }: { claims: ClaimDTO[] }) {
  return (
    <section className="claim-workflow-panel" id="claims">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Falsifiable claims</p>
          <h2>主张与证据</h2>
        </div>
        <FlaskConical size={22} />
      </div>
      <div className="claim-boundary-notice">
        <strong>这里没有“已验证”按钮</strong>
        <p>AI 只能提出候选主张。当前流程负责收集与人工审核证据，待审核也不等于真实。</p>
      </div>
      {claims.length ? (
        <div className="claim-list">
          {claims.map((claim) => <ClaimCard claim={claim} key={claim.id} />)}
        </div>
      ) : (
        <div className="claim-empty">
          <FileSearch size={21} />
          <p>还没有候选主张。运行 AI 整理后，可以逐条勾选“可证伪主张候选”创建。</p>
        </div>
      )}
    </section>
  );
}
