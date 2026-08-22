"use client";

import Image from "next/image";
import Link from "next/link";
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
  ImagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Save,
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
  updateClaimEvidenceAction,
  uploadEvidenceImageAction,
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

const REVIEW_RATIONALE_MIN_LENGTH = 10;
const REVIEW_TEXT_MAX_LENGTH = 2_000;

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
  if (sourceCheck?.verificationMethod === "manual_attachment") {
    return (
      <div className="evidence-source-result is-matched">
        <ShieldCheck size={16} />
        <div>
          <strong>附件已人工核验</strong>
          <p>
            已冻结 {sourceCheck.attachmentSnapshot?.length ?? 0} 张图片
            {sourceCheck.contentHash ? <> · <Fingerprint size={11} /> {sourceCheck.contentHash.slice(0, 12)}…</> : null}
          </p>
          {sourceCheck.verificationNote ? <small>{sourceCheck.verificationNote}</small> : null}
          <small>核验时间：{checkTimeFormatter.format(new Date(sourceCheck.checkedAt))}</small>
        </div>
      </div>
    );
  }
  if (!evidence.sourceUrl) {
    return (
      <div className="evidence-source-result is-unchecked">
        <ShieldAlert size={16} />
        <div>
          <strong>{evidence.attachments.length ? "附件尚未核验" : "未提供来源材料"}</strong>
          <p>
            {evidence.attachments.length
              ? "请先在线查看图片，再点击“核对附件”确认图片与摘录一致。"
              : "请补充来源链接，或先上传至少一张证据图片。"}
          </p>
        </div>
      </div>
    );
  }
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

function firstActionError(result: Awaited<ReturnType<typeof updateClaimEvidenceAction>>) {
  if (result.ok) return "";
  return result.error.fieldErrors
    ? Object.values(result.error.fieldErrors).flat()[0] ?? result.error.message
    : result.error.message;
}

function EvidenceItem({
  claimStatus,
  evidence,
  parentPending,
  checking,
  onCheck,
  onReview,
}: {
  claimStatus: ClaimDTO["status"];
  evidence: EvidenceDTO;
  parentPending: boolean;
  checking: boolean;
  onCheck: (evidence: EvidenceDTO) => void;
  onReview: (evidenceId: string, decision: "accepted" | "rejected") => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [sourceUrl, setSourceUrl] = useState(evidence.sourceUrl);
  const [sourceTitle, setSourceTitle] = useState(evidence.sourceTitle);
  const [excerpt, setExcerpt] = useState(evidence.excerpt);
  const [stance, setStance] = useState(evidence.stance);
  const [note, setNote] = useState(evidence.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const editable = claimStatus === "investigating" && evidence.reviewStatus === "unreviewed";
  const busy = parentPending || isPending;

  function cancelEdit() {
    setSourceUrl(evidence.sourceUrl);
    setSourceTitle(evidence.sourceTitle);
    setExcerpt(evidence.excerpt);
    setStance(evidence.stance);
    setNote(evidence.note ?? "");
    setMessage("");
    setEditing(false);
  }

  function saveEdit() {
    setMessage("");
    startTransition(async () => {
      const result = await updateClaimEvidenceAction({
        evidenceId: evidence.id,
        expectedVersion: evidence.version,
        sourceUrl,
        sourceTitle,
        excerpt,
        stance,
        note: note || undefined,
      });
      if (!result.ok) {
        setMessage(firstActionError(result));
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function uploadImage() {
    if (!file) return;
    setMessage("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("evidenceId", evidence.id);
      formData.set("file", file);
      const result = await uploadEvidenceImageAction(formData);
      if (!result.ok) {
        setMessage(
          result.error.fieldErrors
            ? Object.values(result.error.fieldErrors).flat()[0] ?? result.error.message
            : result.error.message,
        );
        return;
      }
      setFile(null);
      router.refresh();
    });
  }

  return (
    <article>
      <header>
        <span className={`evidence-stance is-${evidence.stance}`}>{stanceLabels[evidence.stance]}</span>
        <span className={`evidence-review is-${evidence.reviewStatus}`}>{evidenceStatusLabels[evidence.reviewStatus]}</span>
        <small>v{evidence.version}</small>
      </header>

      {editing ? (
        <div className="evidence-edit-form">
          <div className="evidence-form-grid">
            <label><span>来源标题</span><input maxLength={300} onChange={(event) => setSourceTitle(event.target.value)} value={sourceTitle} /></label>
            <label><span>来源 URL（可选）</span><input maxLength={2000} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" type="url" value={sourceUrl} /></label>
            <label className="wide"><span>证据原文摘录</span><textarea maxLength={2000} onChange={(event) => setExcerpt(event.target.value)} rows={3} value={excerpt} /></label>
            <label><span>与主张的关系</span><select onChange={(event) => setStance(event.target.value as typeof stance)} value={stance}><option value="supports">支持</option><option value="contradicts">反驳</option><option value="context">仅提供背景</option></select></label>
            <label><span>备注（可选）</span><input maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} /></label>
          </div>
          <p className="evidence-edit-warning">保存后会生成历史版本，并清除当前来源检查；重新采纳前必须再次检查来源。</p>
          <div className="evidence-review-actions">
            <button className="button button-quiet" disabled={busy} onClick={cancelEdit} type="button"><X size={14} /> 取消</button>
            <button className="button button-primary" disabled={busy || !sourceTitle.trim() || !excerpt.trim()} onClick={saveEdit} type="button"><Save size={14} /> {isPending ? "正在保存" : "保存修改"}</button>
          </div>
        </div>
      ) : (
        <>
          {evidence.sourceUrl ? (
            <a href={evidence.sourceUrl} rel="noreferrer" target="_blank">{evidence.sourceTitle} <ExternalLink size={12} /></a>
          ) : (
            <strong>{evidence.sourceTitle}</strong>
          )}
          <blockquote>“{evidence.excerpt}”</blockquote>
          {evidence.note ? <p>{evidence.note}</p> : null}
        </>
      )}

      {evidence.attachments.length ? (
        <div className="evidence-attachments">
          {evidence.attachments.map((attachment) => (
            <figure key={attachment.id}>
              <a href={`/api/evidence-images/${attachment.id}`} rel="noreferrer" target="_blank">
                <Image alt={attachment.originalName} fill sizes="(max-width: 700px) 100vw, 220px" src={`/api/evidence-images/${attachment.id}`} unoptimized />
              </a>
              <figcaption title={attachment.originalName}>
                {attachment.originalName}
                <small>{(attachment.byteSize / 1024).toFixed(1)} KB · SHA-256 {attachment.sha256.slice(0, 10)}…</small>
                <a href={`/api/evidence-images/${attachment.id}`} rel="noreferrer" target="_blank">在线查看原图 <ExternalLink size={10} /></a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {editable && evidence.attachments.length < 5 ? (
        <div className="evidence-upload">
          <label className="button button-quiet">
            <ImagePlus size={14} /> {file ? file.name : "选择证据图片"}
            <input accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
          </label>
          <button className="button button-quiet" disabled={busy || !file} onClick={uploadImage} type="button">{isPending ? <LoaderCircle className="processing-spinner" size={14} /> : <ImagePlus size={14} />} {isPending ? "正在上传" : "上传图片"}</button>
          <small>JPEG / PNG / WebP / GIF，单张不超过 10 MB，最多 5 张。</small>
        </div>
      ) : null}

      {!editing ? <EvidenceSourceResult evidence={evidence} /> : null}
      {evidence.revisions.length ? (
        <details className="evidence-revisions">
          <summary>查看 {evidence.revisions.length} 个历史版本</summary>
          {evidence.revisions.map((revision) => (
            <div key={revision.id}><b>v{revision.version} · {revision.sourceTitle}</b><p>“{revision.excerpt}”</p><small>{checkTimeFormatter.format(new Date(revision.createdAt))}</small></div>
          ))}
        </details>
      ) : null}
      {editable && !editing ? (
        <div className="evidence-review-actions">
          <button className="button button-quiet" disabled={busy} onClick={() => setEditing(true)} type="button"><Pencil size={14} /> 编辑</button>
          <button className="button button-quiet" disabled={busy || (!evidence.sourceUrl && evidence.attachments.length === 0)} onClick={() => onCheck(evidence)} title={!evidence.sourceUrl && evidence.attachments.length === 0 ? "请先上传至少一张证据图片" : undefined} type="button">
            {checking ? <LoaderCircle className="processing-spinner" size={14} /> : evidence.sourceCheck ? <RefreshCw size={14} /> : <ShieldCheck size={14} />}
            {checking
              ? evidence.sourceUrl ? "正在检查来源" : "正在记录核验"
              : evidence.sourceUrl
                ? evidence.sourceCheck ? "重新检查来源" : "检查来源"
                : evidence.sourceCheck ? "重新核对附件" : "核对附件"}
          </button>
          <button className="button button-quiet" disabled={busy} onClick={() => onReview(evidence.id, "rejected")} type="button"><X size={14} /> 排除</button>
          <button className="button button-primary" disabled={busy || evidence.sourceCheckStatus !== "passed" || evidence.sourceExcerptMatch !== true} onClick={() => onReview(evidence.id, "accepted")} type="button"><Check size={14} /> 采纳</button>
        </div>
      ) : null}
      {message ? <p className="form-error claim-message">{message}</p> : null}
    </article>
  );
}

function ClaimCard({ claim }: { claim: ClaimDTO }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isConcluding, setIsConcluding] = useState(false);
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
  const acceptedSupportingEvidenceCount = claim.evidence.filter(
    (evidence) =>
      evidence.reviewStatus === "accepted" && evidence.stance === "supports",
  ).length;
  const acceptedContradictingEvidenceCount = claim.evidence.filter(
    (evidence) =>
      evidence.reviewStatus === "accepted" && evidence.stance === "contradicts",
  ).length;
  const trimmedRationaleLength = rationale.trim().length;
  const rationaleLengthSatisfied =
    trimmedRationaleLength >= REVIEW_RATIONALE_MIN_LENGTH;
  const assessmentEvidenceSatisfied =
    assessment === "supported"
      ? acceptedSupportingEvidenceCount > 0
      : assessment === "refuted"
        ? acceptedContradictingEvidenceCount > 0
        : acceptedEvidenceCount > 0;
  const canConclude = rationaleLengthSatisfied && assessmentEvidenceSatisfied;
  const rationaleHelpId = `claim-${claim.id}-rationale-help`;
  const assessmentHelpId = `claim-${claim.id}-assessment-help`;

  const assessmentRequirement =
    assessment === "supported"
      ? `需要至少 1 条已采纳的支持证据；当前 ${acceptedSupportingEvidenceCount} 条。`
      : assessment === "refuted"
        ? `需要至少 1 条已采纳的反驳证据；当前 ${acceptedContradictingEvidenceCount} 条。`
        : `需要至少 1 条已采纳证据；当前 ${acceptedEvidenceCount} 条。`;

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

  function checkEvidenceSource(evidence: EvidenceDTO) {
    const manualConfirmation = !evidence.sourceUrl;
    if (
      manualConfirmation &&
      !window.confirm(
        "请先在线查看全部图片。确认继续即表示：你已核对图片内容，并确认保存的证据摘录与图片一致。",
      )
    ) {
      return;
    }
    setMessage("");
    setCheckingEvidenceId(evidence.id);
    startTransition(async () => {
      const result = await checkClaimEvidenceSourceAction({
        evidenceId: evidence.id,
        manualConfirmation,
      });
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
    setIsConcluding(true);
    startTransition(async () => {
      try {
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
      } finally {
        setIsConcluding(false);
      }
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
              <label><span>来源 URL（可选）</span><input aria-label={`${claim.statement} 来源 URL`} maxLength={2000} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" type="url" value={sourceUrl} /></label>
              <label className="wide"><span>证据原文摘录</span><textarea aria-label={`${claim.statement} 证据摘录`} maxLength={2000} onChange={(event) => setExcerpt(event.target.value)} rows={3} value={excerpt} /></label>
              <label><span>与主张的关系</span><select aria-label={`${claim.statement} 证据立场`} onChange={(event) => setStance(event.target.value as typeof stance)} value={stance}><option value="supports">支持</option><option value="contradicts">反驳</option><option value="context">仅提供背景</option></select></label>
              <label><span>备注（可选）</span><input aria-label={`${claim.statement} 证据备注`} maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} /></label>
            </div>
            <button className="button button-quiet" disabled={isPending || !sourceTitle.trim() || !excerpt.trim()} onClick={addEvidence} type="button"><Plus size={15} /> 保存为未审核证据</button>
          </div>
        </>
      ) : null}

      {claim.evidence.length ? (
        <div className="evidence-list">
          {claim.evidence.map((evidence) => (
            <EvidenceItem
              checking={checkingEvidenceId === evidence.id}
              claimStatus={claim.status}
              evidence={evidence}
              key={evidence.id}
              onCheck={checkEvidenceSource}
              onReview={reviewEvidence}
              parentPending={isPending}
            />
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
              <span className="review-field-heading"><b>结论类型（必选）</b><small>选择 1 项</small></span>
              <select aria-describedby={assessmentHelpId} aria-label={`${claim.statement} 结论类型`} onChange={(event) => setAssessment(event.target.value as typeof assessment)} required value={assessment}>
                <option value="inconclusive">证据不足</option>
                <option value="supported">现有证据支持</option>
                <option value="refuted">现有证据反驳</option>
              </select>
              <small className={assessmentEvidenceSatisfied ? "review-field-help is-valid" : "review-field-help is-invalid"} id={assessmentHelpId}>
                {assessmentRequirement}
              </small>
            </label>
            <label>
              <span className="review-field-heading"><b>结论依据（必填）</b><small>10–2,000 个字符</small></span>
              <textarea
                aria-describedby={rationaleHelpId}
                aria-invalid={rationale.length > 0 && !rationaleLengthSatisfied}
                aria-label={`${claim.statement} 结论依据`}
                maxLength={REVIEW_TEXT_MAX_LENGTH}
                minLength={REVIEW_RATIONALE_MIN_LENGTH}
                onChange={(event) => setRationale(event.target.value)}
                placeholder="说明采纳了哪些证据、为什么得到这个结论……"
                required
                rows={4}
                value={rationale}
              />
              <span className="review-field-meta" id={rationaleHelpId}>
                <small className={rationaleLengthSatisfied ? "is-valid" : "is-invalid"}>
                  {rationaleLengthSatisfied
                    ? "已满足最少字符要求"
                    : `还需 ${REVIEW_RATIONALE_MIN_LENGTH - trimmedRationaleLength} 个字符`}
                </small>
                <small>{rationale.length.toLocaleString()} / {REVIEW_TEXT_MAX_LENGTH.toLocaleString()}</small>
              </span>
            </label>
            <label>
              <span className="review-field-heading"><b>限制与未知（选填）</b><small>最多 2,000 个字符</small></span>
              <textarea aria-label={`${claim.statement} 结论限制`} maxLength={REVIEW_TEXT_MAX_LENGTH} onChange={(event) => setLimitations(event.target.value)} placeholder="样本范围、时间边界、仍存在的反例……" rows={3} value={limitations} />
              <span className="review-field-meta"><small>不填写也可以保存</small><small>{limitations.length.toLocaleString()} / {REVIEW_TEXT_MAX_LENGTH.toLocaleString()}</small></span>
            </label>
            <div aria-live="polite" className="review-save-requirements">
              <strong>保存前需满足</strong>
              <ul>
                <li className={assessmentEvidenceSatisfied ? "is-valid" : "is-invalid"}>
                  {assessmentEvidenceSatisfied ? <Check size={13} /> : <CircleDot size={13} />}
                  所选结论具备对应的已采纳证据
                </li>
                <li className={rationaleLengthSatisfied ? "is-valid" : "is-invalid"}>
                  {rationaleLengthSatisfied ? <Check size={13} /> : <CircleDot size={13} />}
                  结论依据不少于 {REVIEW_RATIONALE_MIN_LENGTH} 个字符
                </li>
              </ul>
            </div>
            {message ? <p aria-live="assertive" className="form-error review-submit-message" role="alert">未能完成操作：{message}</p> : null}
            {isConcluding ? <p aria-live="polite" className="review-submit-status">正在保存结论并冻结 {acceptedEvidenceCount} 条证据快照，请稍候……</p> : null}
            <button aria-busy={isConcluding} className="button button-primary" disabled={isPending || !canConclude} onClick={conclude} type="button">
              {isConcluding ? <LoaderCircle className="processing-spinner" size={15} /> : <Check size={15} />}
              {isConcluding ? "正在保存人工结论…" : "保存人工结论"}
            </button>
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
          <Link className="button button-quiet claim-reliability-link" href={`/claims/${claim.id}/reliability`}>
            <ShieldCheck size={14} /> 来源权威性、独立复核与可靠发布
          </Link>
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
      {message && claim.status !== "ready_for_review" ? <p className="form-error claim-message">{message}</p> : null}
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
