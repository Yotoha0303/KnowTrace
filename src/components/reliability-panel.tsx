"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  CircleDot,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  LoaderCircle,
  Scale,
  ShieldCheck,
} from "lucide-react";

import {
  assessSourceAuthorityAction,
  publishReliableKnowledgeAction,
  submitIndependentReviewAction,
} from "@/app/actions";
import type { ActionActor } from "@/features/auth/actor";
import type { ReliabilityDossierDTO } from "@/features/reliability/queries";
import type { SourceAuthorityLevel } from "@/features/reliability/schema";

const authorityLabels: Record<SourceAuthorityLevel, string> = {
  primary: "第一手 / 原始材料",
  official: "官方机构 / 正式发布",
  expert: "专业研究 / 专家来源",
  secondary: "二手报道 / 汇总",
  community: "个人经验 / 社区内容",
  unknown: "尚无法判断",
};

const assessmentLabels = {
  supported: "现有证据支持",
  refuted: "现有证据反驳",
  inconclusive: "证据不足",
} as const;

function AuthorityForm({
  evidence,
}: {
  evidence: ReliabilityDossierDTO["evidence"][number];
}) {
  const router = useRouter();
  const [level, setLevel] = useState<SourceAuthorityLevel>(evidence.authority?.level ?? "unknown");
  const [publisher, setPublisher] = useState(evidence.authority?.publisher ?? "");
  const [rationale, setRationale] = useState(evidence.authority?.rationale ?? "");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const canSave = publisher.trim().length >= 2 && rationale.trim().length >= 10;

  function save() {
    setMessage("");
    startTransition(async () => {
      const result = await assessSourceAuthorityAction({
        evidenceId: evidence.id,
        level,
        publisher,
        rationale,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setMessage("已保存当前证据版本的来源权威性评估。");
      router.refresh();
    });
  }

  return (
    <div className="authority-form">
      <label><span>来源层级（必填）</span><select disabled={isPending} onChange={(event) => setLevel(event.target.value as SourceAuthorityLevel)} value={level}>{Object.entries(authorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>发布主体（必填，2–300 字）</span><input maxLength={300} onChange={(event) => setPublisher(event.target.value)} placeholder="机构、作者、当事人或材料出具方" value={publisher} /></label>
      <label className="wide"><span>权威性依据（必填，10–1,000 字）</span><textarea maxLength={1_000} onChange={(event) => setRationale(event.target.value)} placeholder="说明它为何属于该层级、可能存在何种利益关系或局限。" rows={3} value={rationale} /><small>{rationale.trim().length} / 1,000</small></label>
      <button className="button button-quiet" disabled={isPending || !canSave} onClick={save} type="button">{isPending ? <LoaderCircle className="processing-spinner" size={14} /> : <FileCheck2 size={14} />}{isPending ? "正在保存…" : evidence.authority ? "更新评估" : "保存评估"}</button>
      {message ? <p className="authority-message">{message}</p> : null}
    </div>
  );
}

export function ReliabilityPanel({
  actor,
  dossier,
}: {
  actor: ActionActor;
  dossier: ReliabilityDossierDTO;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<"approved" | "changes_requested">("approved");
  const [reviewRationale, setReviewRationale] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const review = dossier.review;
  const isConclusionAuthor = review?.reviewerId === actor.id;
  const alreadyReviewedByActor = dossier.independentReviews.some(
    (item) => item.reviewerId === actor.id,
  );
  const canSubmitIndependent =
    actor.authenticated &&
    Boolean(review) &&
    !isConclusionAuthor &&
    !alreadyReviewedByActor &&
    reviewRationale.trim().length >= 10;

  function submitIndependent() {
    if (!review) return;
    setMessage("");
    startTransition(async () => {
      const result = await submitIndependentReviewAction({
        claimReviewId: review.id,
        decision,
        rationale: reviewRationale,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setReviewRationale("");
      setMessage("独立复核已保存；发布门槛已重新计算。");
      router.refresh();
    });
  }

  function publish() {
    setMessage("");
    startTransition(async () => {
      const result = await publishReliableKnowledgeAction({ claimId: dossier.claim.id });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setMessage(`可靠知识版本 v${result.data.releaseNumber} 已冻结发布。`);
      router.refresh();
    });
  }

  return (
    <div className="reliability-layout">
      <section className="reliability-summary">
        <div className="reliability-boundary"><ShieldCheck size={18} /><div><strong>发布的是证据边界明确的版本，不是永久真理</strong><p>后续出现反例、新证据或结论变化时，应重新调查并发布新版本；旧版本保持不可变审计历史。</p></div></div>
        <div className="reliability-claim">
          <span>可证伪主张</span><h2>{dossier.claim.statement}</h2>
          <p><strong>证伪条件</strong>{dossier.claim.falsificationCriteria}</p>
        </div>
        {review ? (
          <div className={`reliability-conclusion is-${review.assessment}`}>
            <header><span>{assessmentLabels[review.assessment]}</span><small>结论 v{review.reviewNumber} · 作者 {review.reviewerName}</small></header>
            <p>{review.rationale}</p>{review.limitations ? <aside><strong>限制与未知</strong>{review.limitations}</aside> : null}
          </div>
        ) : <div className="reliability-empty"><CircleAlert size={17} />当前还没有人工结论，不能进入可靠发布。</div>}
      </section>

      <section className="reliability-section">
        <div className="section-title"><div><p className="eyebrow">Source authority</p><h2>来源权威性</h2></div><span>{dossier.evidence.length} 条结论证据</span></div>
        <p className="reliability-help">来源检查只证明摘录与快照匹配；这里另外记录发布主体、材料层级与局限。评估绑定 Evidence 当前版本，证据编辑后必须重做。</p>
        <div className="authority-list">
          {dossier.evidence.map((evidence, index) => (
            <article className="authority-card" key={evidence.id}>
              <header><span>证据 {index + 1} · {evidence.stance === "supports" ? "支持" : evidence.stance === "contradicts" ? "反驳" : "背景"}</span><small>Evidence v{evidence.version} · {evidence.isCurrent ? "快照有效" : "快照已变化"}</small></header>
              <h3>{evidence.sourceTitle}</h3><blockquote>{evidence.excerpt}</blockquote>
              <div className="authority-meta"><span><Fingerprint size={12} />{evidence.sourceIdentity}</span>{evidence.finalUrl.startsWith("http") ? <a href={evidence.finalUrl} rel="noreferrer" target="_blank"><ExternalLink size={12} />来源快照</a> : <span><FileCheck2 size={12} />项目内附件快照</span>}</div>
              {evidence.authority ? <div className="authority-current"><BadgeCheck size={14} /><div><strong>{authorityLabels[evidence.authority.level]} · {evidence.authority.publisher}</strong><p>{evidence.authority.rationale}</p><small>{evidence.authority.assessorName} · {new Date(evidence.authority.createdAt).toLocaleString("zh-CN")}</small></div></div> : null}
              <AuthorityForm evidence={evidence} />
            </article>
          ))}
          {!dossier.evidence.length ? <div className="reliability-empty">当前结论没有冻结证据快照。</div> : null}
        </div>
      </section>

      <section className="reliability-section independent-review-section">
        <div className="section-title"><div><p className="eyebrow">Separation of duties</p><h2>独立复核</h2></div><Scale size={21} /></div>
        <p className="reliability-help">独立复核必须使用与结论作者不同的 go-user-system 登录账号。浏览器填写的姓名不能替代服务端身份。</p>
        <div className="independent-review-identity"><span>当前身份</span><strong>{actor.name}</strong><small>{actor.authenticated ? actor.id : "未启用身份化登录，只能进行本地整理"}</small></div>
        {dossier.independentReviews.length ? <div className="independent-review-history">{dossier.independentReviews.map((item) => <article className={`is-${item.decision}${item.isStale ? " is-stale" : ""}`} key={item.id}><header><span>{item.decision === "approved" ? "批准发布" : "要求修改"}{item.isStale ? " · 输入已变化" : ""}</span><small>{item.reviewerName} · {new Date(item.createdAt).toLocaleString("zh-CN")}</small></header><p>{item.rationale}</p></article>)}</div> : null}
        <div className="independent-review-form">
          {!actor.authenticated ? <p className="reliability-blocker"><CircleAlert size={14} />请先启用 go-user-system 登录，再由另一个账号复核。</p> : isConclusionAuthor ? <p className="reliability-blocker"><CircleAlert size={14} />当前账号是结论作者，不能复核自己的结论。</p> : alreadyReviewedByActor ? <p className="reliability-blocker"><ShieldCheck size={14} />当前账号已经复核过此结论版本；需要修改时应退回调查并形成新结论。</p> : null}
          <label><span>复核决定（必填）</span><select disabled={isPending || !actor.authenticated || isConclusionAuthor || alreadyReviewedByActor} onChange={(event) => setDecision(event.target.value as typeof decision)} value={decision}><option value="approved">批准进入可靠发布</option><option value="changes_requested">要求退回修改</option></select></label>
          <label><span>复核依据（必填，10–2,000 字）</span><textarea disabled={!actor.authenticated || isConclusionAuthor || alreadyReviewedByActor} maxLength={2_000} onChange={(event) => setReviewRationale(event.target.value)} placeholder="说明是否检查了证伪条件、来源独立性、权威性、反例与适用范围。" rows={4} value={reviewRationale} /><small>{reviewRationale.trim().length} / 2,000</small></label>
          <button className="button button-dark" disabled={isPending || !canSubmitIndependent} onClick={submitIndependent} type="button">{isPending ? <LoaderCircle className="processing-spinner" size={15} /> : <Scale size={15} />}保存独立复核</button>
        </div>
      </section>

      <section className="reliability-section release-readiness-section">
        <div className="section-title"><div><p className="eyebrow">Release gates</p><h2>可靠发布门槛</h2></div><span>{dossier.readiness.filter((item) => item.passed).length} / {dossier.readiness.length}</span></div>
        <ul className="release-checklist">{dossier.readiness.map((item) => <li className={item.passed ? "is-passed" : "is-blocked"} key={item.code}>{item.passed ? <Check size={14} /> : <CircleDot size={14} />}<span>{item.label}</span></li>)}</ul>
        <button className="button button-primary release-button" disabled={isPending || !dossier.readyToPublish} onClick={publish} type="button">{isPending ? <LoaderCircle className="processing-spinner" size={16} /> : <BadgeCheck size={16} />}{isPending ? "正在冻结发布快照…" : "冻结并发布可靠知识版本"}</button>
        {message ? <p className="reliability-action-message">{message}</p> : null}
        {dossier.releases.length ? <div className="release-history"><h3>不可变发布历史</h3>{dossier.releases.map((release) => <article key={release.id}><div><strong>可靠知识 v{release.releaseNumber}</strong><span>{release.publishedByName} · {new Date(release.createdAt).toLocaleString("zh-CN")}</span></div><code>{release.snapshotHash}</code></article>)}</div> : null}
      </section>
    </div>
  );
}
