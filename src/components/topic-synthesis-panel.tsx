"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import {
  decideTopicSynthesisAction,
  detectCCSwitchAction,
  generateTopicSynthesisAction,
  testCCSwitchCodexOAuthAction,
} from "@/app/actions";
import { DEFAULT_CC_SWITCH_BASE_URL } from "@/features/ai-processing/connection";
import type {
  TopicSynthesisDTO,
} from "@/features/topic-synthesis/queries";

const AI_CREDENTIAL_SESSION_KEY = "knowtrace.ai-credentials.v1";

type Provider = "mock" | "openai" | "deepseek";
type OpenAIMode = "api_key" | "ccswitch" | "ccswitch_codex_oauth";
type Credentials = {
  openAIConnectionMode: OpenAIMode;
  openAIKey: string;
  openAIModel: string;
  ccSwitchCodexModel: string;
  ccSwitchBaseURL: string;
  ccSwitchToken: string;
  deepSeekKey: string;
  deepSeekModel: string;
};

const DEFAULT_CREDENTIALS: Credentials = {
  openAIConnectionMode: "ccswitch_codex_oauth",
  openAIKey: "",
  openAIModel: "",
  ccSwitchCodexModel: "claude-sonnet-4-5",
  ccSwitchBaseURL: DEFAULT_CC_SWITCH_BASE_URL,
  ccSwitchToken: "",
  deepSeekKey: "",
  deepSeekModel: "",
};

const supportLabels = {
  human_review: "人工审核依据",
  candidate_claim: "候选主张依据",
  raw_record: "原始记录依据",
} as const;

function providerLabel(provider: string) {
  if (provider === "ccswitch-codex-oauth") return "CC-Switch · Codex OAuth";
  if (provider === "openai-ccswitch") return "OpenAI · CC-Switch";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "openai") return "OpenAI";
  return "本地规则";
}

function parseCredentials(raw: string | null): Credentials {
  if (!raw) return DEFAULT_CREDENTIALS;
  try {
    return { ...DEFAULT_CREDENTIALS, ...(JSON.parse(raw) as Partial<Credentials>) };
  } catch {
    return DEFAULT_CREDENTIALS;
  }
}

function subscribeCredentials(onStoreChange: () => void) {
  window.addEventListener("knowtrace-ai-credentials-changed", onStoreChange);
  return () => window.removeEventListener("knowtrace-ai-credentials-changed", onStoreChange);
}

function credentialsSnapshot() {
  return window.sessionStorage.getItem(AI_CREDENTIAL_SESSION_KEY);
}

function serverCredentialsSnapshot() {
  return null;
}

export function TopicSynthesisPanel({
  categoryId,
  currentCaptureCount,
  history,
}: {
  categoryId: string;
  currentCaptureCount: number;
  history: TopicSynthesisDTO[];
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("mock");
  const savedCredentialsRaw = useSyncExternalStore(
    subscribeCredentials,
    credentialsSnapshot,
    serverCredentialsSnapshot,
  );
  const savedCredentials = parseCredentials(savedCredentialsRaw);
  const [credentialDraft, setCredentialDraft] = useState<Credentials | null>(null);
  const credentials = credentialDraft ?? savedCredentials;
  const rememberCredentials = savedCredentialsRaw !== null;
  const [processing, setProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionReady, setConnectionReady] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isConnectionPending, startConnectionTransition] = useTransition();
  const latest = history[0] ?? null;
  const displayed = history.find((item) => item.status === "succeeded" && item.payload) ?? null;
  const payload = displayed?.payload ?? null;

  const captureRefs = new Map(displayed?.captureRefs.map((item) => [item.id, item]) ?? []);
  const claimRefs = new Map(displayed?.claimRefs.map((item) => [item.id, item]) ?? []);
  const busy = processing || isPending || isConnectionPending;
  const usesCCSwitch =
    provider === "openai" && credentials.openAIConnectionMode !== "api_key";

  useEffect(() => {
    if (!processing) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000)),
      500,
    );
    return () => window.clearInterval(timer);
  }, [processing]);

  useEffect(() => {
    if (!usesCCSwitch) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setConnectionMessage("正在自动检测 CC-Switch…");
      setConnectionReady(false);
      void detectCCSwitchAction({
        baseURL: credentials.ccSwitchBaseURL.trim() || DEFAULT_CC_SWITCH_BASE_URL,
      }).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setConnectionReady(true);
          setConnectionMessage(`已连接 CC-Switch（${result.data.latencyMs}ms）`);
        } else {
          setConnectionMessage(result.error.message);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [credentials.ccSwitchBaseURL, usesCCSwitch]);

  function updateCredentials(patch: Partial<Credentials>) {
    const next = { ...credentials, ...patch };
    setCredentialDraft(next);
    if (rememberCredentials) {
      window.sessionStorage.setItem(AI_CREDENTIAL_SESSION_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("knowtrace-ai-credentials-changed"));
    }
  }

  function toggleRemember(remember: boolean) {
    setCredentialDraft(credentials);
    if (remember) {
      window.sessionStorage.setItem(AI_CREDENTIAL_SESSION_KEY, JSON.stringify(credentials));
    } else {
      window.sessionStorage.removeItem(AI_CREDENTIAL_SESSION_KEY);
    }
    window.dispatchEvent(new Event("knowtrace-ai-credentials-changed"));
  }

  function changeProvider(next: Provider) {
    setProvider(next);
    setConnectionMessage("");
    setConnectionReady(false);
  }

  function changeOpenAIMode(next: OpenAIMode) {
    updateCredentials({ openAIConnectionMode: next });
    setConnectionMessage("");
    setConnectionReady(false);
  }

  function changeCCSwitchBaseURL(next: string) {
    updateCredentials({ ccSwitchBaseURL: next });
    setConnectionMessage("");
    setConnectionReady(false);
  }

  function connectionForRequest() {
    if (provider === "openai") {
      if (credentials.openAIConnectionMode === "ccswitch_codex_oauth") {
        return {
          mode: "ccswitch_codex_oauth" as const,
          baseURL: credentials.ccSwitchBaseURL.trim() || DEFAULT_CC_SWITCH_BASE_URL,
          apiKey: credentials.ccSwitchToken.trim() || undefined,
          model: credentials.ccSwitchCodexModel.trim() || "claude-sonnet-4-5",
        };
      }
      if (credentials.openAIConnectionMode === "ccswitch") {
        return {
          mode: "ccswitch" as const,
          baseURL: credentials.ccSwitchBaseURL.trim() || DEFAULT_CC_SWITCH_BASE_URL,
          apiKey: credentials.ccSwitchToken.trim() || undefined,
          model: credentials.openAIModel.trim() || undefined,
        };
      }
      return credentials.openAIKey.trim()
        ? {
            mode: "api_key" as const,
            apiKey: credentials.openAIKey.trim(),
            model: credentials.openAIModel.trim() || undefined,
          }
        : { mode: "server" as const, model: credentials.openAIModel.trim() || undefined };
    }
    if (provider === "deepseek") {
      return credentials.deepSeekKey.trim()
        ? {
            mode: "api_key" as const,
            apiKey: credentials.deepSeekKey.trim(),
            model: credentials.deepSeekModel.trim() || undefined,
          }
        : { mode: "server" as const, model: credentials.deepSeekModel.trim() || undefined };
    }
    return undefined;
  }

  function generate() {
    setMessage("");
    setProcessing(true);
    setElapsedSeconds(0);
    startTransition(async () => {
      const result = await generateTopicSynthesisAction({
        categoryId,
        provider,
        connection: connectionForRequest(),
      });
      setProcessing(false);
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setMessage("主题档案已生成，请检查引用与边界后决定是否接受。");
      router.refresh();
    });
  }

  function decide(decision: "accepted" | "rejected") {
    if (!displayed) return;
    setMessage("");
    startTransition(async () => {
      const result = await decideTopicSynthesisAction({
        synthesisId: displayed.id,
        decision,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setMessage(decision === "accepted" ? "已接受为当前主题档案。" : "已驳回该主题档案。");
      router.refresh();
    });
  }

  function testConnection() {
    setConnectionMessage("正在发送最小模型请求…");
    startConnectionTransition(async () => {
      const result = await testCCSwitchCodexOAuthAction({
        baseURL: credentials.ccSwitchBaseURL.trim() || DEFAULT_CC_SWITCH_BASE_URL,
        apiKey: credentials.ccSwitchToken.trim() || undefined,
        model: credentials.ccSwitchCodexModel.trim() || "claude-sonnet-4-5",
      });
      if (result.ok) {
        setConnectionReady(true);
        setConnectionMessage(
          `AI 测试成功：${result.data.requestedModel} → ${result.data.actualModel}（${result.data.latencyMs}ms）`,
        );
      } else {
        setConnectionReady(false);
        setConnectionMessage(result.error.message);
      }
    });
  }

  return (
    <section className="topic-synthesis-panel" aria-label="AI 主题综合档案">
      <header className="topic-synthesis-heading">
        <div>
          <p className="eyebrow">AI synthesis</p>
          <h2>主题综合档案</h2>
          <p>综合当前 {currentCaptureCount} 条活跃记录；AI 输出必须回链到输入，接受前不会成为当前档案。</p>
        </div>
        <Bot size={24} />
      </header>

      <div className="topic-synthesis-controls">
        <label>
          <span>处理方式</span>
          <select disabled={busy} onChange={(event) => changeProvider(event.target.value as Provider)} value={provider}>
            <option value="mock">本地规则（不调用外部 AI）</option>
            <option value="openai">OpenAI / CC-Switch</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </label>
        {provider === "openai" ? (
          <div className="topic-connection-fields">
            <label>
              <span>连接方式</span>
              <select
                disabled={busy}
                onChange={(event) => changeOpenAIMode(event.target.value as OpenAIMode)}
                value={credentials.openAIConnectionMode}
              >
                <option value="ccswitch_codex_oauth">CC-Switch · Codex OAuth</option>
                <option value="api_key">OpenAI API Key</option>
                <option value="ccswitch">CC-Switch · OpenAI Responses</option>
              </select>
            </label>
            {credentials.openAIConnectionMode === "api_key" ? (
              <>
                <label><span>OpenAI API Key（留空使用服务端）</span><input autoComplete="off" onChange={(event) => updateCredentials({ openAIKey: event.target.value })} type="password" value={credentials.openAIKey} /></label>
                <label><span>模型 ID（可选）</span><input onChange={(event) => updateCredentials({ openAIModel: event.target.value })} value={credentials.openAIModel} /></label>
              </>
            ) : (
              <>
                <label><span>CC-Switch 地址</span><input onChange={(event) => changeCCSwitchBaseURL(event.target.value)} value={credentials.ccSwitchBaseURL} /></label>
                <label><span>{credentials.openAIConnectionMode === "ccswitch_codex_oauth" ? "Claude 模型别名" : "模型 ID（可选）"}</span><input onChange={(event) => updateCredentials(credentials.openAIConnectionMode === "ccswitch_codex_oauth" ? { ccSwitchCodexModel: event.target.value } : { openAIModel: event.target.value })} value={credentials.openAIConnectionMode === "ccswitch_codex_oauth" ? credentials.ccSwitchCodexModel : credentials.openAIModel} /></label>
              </>
            )}
            {usesCCSwitch ? (
              <div className={`topic-connection-status${connectionReady ? " is-ready" : ""}`} role="status">
                <PlugZap size={14} /><span>{connectionMessage || "等待检测"}</span>
                {credentials.openAIConnectionMode === "ccswitch_codex_oauth" ? <button className="button button-quiet" disabled={busy} onClick={testConnection} type="button">测试 AI 登录</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {provider === "deepseek" ? (
          <div className="topic-connection-fields">
            <label><span>DeepSeek API Key（留空使用服务端）</span><input autoComplete="off" onChange={(event) => updateCredentials({ deepSeekKey: event.target.value })} type="password" value={credentials.deepSeekKey} /></label>
            <label><span>模型 ID（可选）</span><input onChange={(event) => updateCredentials({ deepSeekModel: event.target.value })} value={credentials.deepSeekModel} /></label>
          </div>
        ) : null}
        {provider !== "mock" ? (
          <label className="topic-remember"><input checked={rememberCredentials} onChange={(event) => toggleRemember(event.target.checked)} type="checkbox" /><span>仅在当前浏览器标签页记住凭据</span></label>
        ) : null}
        <button className="button button-dark" disabled={busy || currentCaptureCount === 0 || (usesCCSwitch && !connectionReady)} onClick={generate} type="button">
          {processing ? <LoaderCircle className="processing-spinner" size={16} /> : <Sparkles size={16} />}
          {processing ? `正在综合 ${elapsedSeconds}s` : displayed ? "基于当前输入重新生成" : "生成主题综合档案"}
        </button>
        {processing ? <p className="topic-processing-note" role="status">正在读取保存的记录、主张与人工结论，随后校验结构化引用…</p> : null}
      </div>

      {latest?.status === "failed" ? (
        <div className="topic-synthesis-warning"><CircleAlert size={16} /><span>最近一次生成失败：{latest.errorCode || "未知错误"}。已有成功档案仍被保留。</span></div>
      ) : null}

      {displayed && payload ? (
        <article className={`topic-synthesis-result${displayed.isStale ? " is-stale" : ""}`}>
          <header>
            <div>
              <span className={`topic-decision is-${displayed.decision}`}>{displayed.decision === "accepted" ? "已接受" : displayed.decision === "rejected" ? "已驳回" : "待决定"}</span>
              {displayed.isStale ? <b><RotateCcw size={13} /> 输入已变化</b> : null}
            </div>
            <small>{providerLabel(displayed.provider)} / {displayed.model} · {new Date(displayed.createdAt).toLocaleString("zh-CN")}</small>
          </header>
          <p className="topic-overview">{payload.overview}</p>
          {payload.established_points.length ? (
            <section><h3>当前可归纳要点</h3><div className="topic-point-list">{payload.established_points.map((point, index) => (
              <div key={`${point.text}-${index}`}><header><span>{supportLabels[point.support_basis]}</span></header><p>{point.text}</p><div className="topic-source-links">
                {point.source_capture_ids.map((id) => <Link href={`/captures/${id}`} key={id}><ExternalLink size={11} />{captureRefs.get(id)?.title || "原始记录"}</Link>)}
                {point.claim_ids.map((id) => { const claim = claimRefs.get(id); return claim ? <Link href={`/captures/${claim.captureId}#claims`} key={id}><ShieldCheck size={11} />{claim.statement}</Link> : null; })}
              </div></div>
            ))}</div></section>
          ) : null}
          {payload.tensions.length ? <section><h3>冲突与边界</h3><ul>{payload.tensions.map((item, index) => <li key={`${item.text}-${index}`}>{item.text}</li>)}</ul></section> : null}
          {payload.chronology.length ? <section><h3>时间脉络</h3><div className="topic-chronology">{payload.chronology.map((item, index) => <div key={`${item.occurred_at}-${index}`}><time><Clock3 size={12} />{new Date(item.occurred_at).toLocaleDateString("zh-CN")}</time><p>{item.text}</p><div className="topic-source-links">{item.source_capture_ids.map((id) => <Link href={`/captures/${id}`} key={id}>{captureRefs.get(id)?.title || "查看记录"}</Link>)}</div></div>)}</div></section> : null}
          <div className="topic-followup-grid">
            <section><h3>尚待回答</h3>{payload.open_questions.length ? <ol>{payload.open_questions.map((item) => <li key={item}>{item}</li>)}</ol> : <p>当前没有额外问题。</p>}</section>
            <section><h3>建议下一步</h3>{payload.next_steps.length ? <ol>{payload.next_steps.map((item) => <li key={item}>{item}</li>)}</ol> : <p>当前没有额外行动建议。</p>}</section>
          </div>
          <footer><ShieldCheck size={14} /><span>{payload.boundary_notice}</span><small>{displayed.sourceCaptureCount} 条记录 · {displayed.sourceClaimCount} 条主张{displayed.sourceTruncated ? " · 输入因长度上限已截断" : ""}</small></footer>
          {displayed.decision === "pending" ? (
            <div className="topic-synthesis-actions">
              <button className="button button-quiet" disabled={busy || displayed.isStale} onClick={() => decide("rejected")} type="button"><X size={15} /> 驳回</button>
              <button className="button button-primary" disabled={busy || displayed.isStale} onClick={() => decide("accepted")} type="button"><Check size={15} /> 接受为当前档案</button>
              {displayed.isStale ? <span>输入变化后不能接受旧档案，请重新生成。</span> : null}
            </div>
          ) : null}
        </article>
      ) : (
        <div className="topic-synthesis-empty"><Sparkles size={20} /><div><strong>尚未生成主题综合档案</strong><p>可以先用本地规则验证流程；外部 AI 只会收到该主题的当前输入快照。</p></div></div>
      )}

      {message ? <p className="form-error action-message">{message}</p> : null}
      {history.length ? <details className="topic-synthesis-history"><summary>生成历史 · {history.length}</summary>{history.map((item) => <div key={item.id}><span>{providerLabel(item.provider)} · {item.status === "succeeded" ? item.decision === "accepted" ? "已接受" : item.decision === "rejected" ? "已驳回" : "待决定" : item.status === "failed" ? "失败" : "处理中"}{item.isStale ? " · 输入已变化" : ""}</span><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></div>)}</details> : null}
    </section>
  );
}
