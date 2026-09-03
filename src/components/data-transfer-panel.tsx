"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileSearch,
  LoaderCircle,
  RotateCcw,
  Upload,
  XCircle,
} from "lucide-react";

type Issue = { sheet: string; row: number; field: string; message: string };
type TransferMode = "v1" | "v2";
type BaseSummary = {
  valid: boolean;
  recordsTotal: number;
  recordsToCreate: number;
  recordsToSkip: number;
  categoriesTotal: number;
  categoriesToCreate: number;
  categoriesToReuse: number;
  relationshipsTotal: number;
  issues: Issue[];
};
type ObjectPreview = {
  total: number;
  toCreate: number;
  toSkip: number;
  toRepair: number;
  conflicts: number;
};
type KnowledgePreview = {
  valid: boolean;
  claims: ObjectPreview;
  evidence: ObjectPreview;
  attachments: ObjectPreview;
  historicalContext: {
    sourceChecks: number;
    attachmentChecks: number;
    reviews: number;
    reviewEvidenceRelationships: number;
  };
  downgraded: {
    claimTrustStates: number;
    claimSourceVersions: number;
    evidenceVersions: number;
    evidenceReviewStates: number;
    evidenceCheckStates: number;
    reviews: number;
  };
  issues: Issue[];
};
type V1Preview = {
  mode: "v1";
  runId: string;
  status: "previewed" | "failed";
  summary: BaseSummary;
};
type V2Preview = {
  mode: "v2";
  runId: string | null;
  status: "previewed" | "failed";
  summary: {
    valid: boolean;
    packageIssues: Issue[];
    base: BaseSummary | null;
    knowledge: KnowledgePreview | null;
    issues: Issue[];
  };
};
type Preview = V1Preview | V2Preview;

type BaseImportResult = {
  recordsCreated: number;
  recordsSkipped: number;
  categoriesCreated: number;
  categoriesReused: number;
  relationshipsCreated: number;
};
type V2ImportResult = BaseImportResult & {
  claimsCreated: number;
  claimsSkipped: number;
  claimsRepaired: number;
  evidenceCreated: number;
  evidenceSkipped: number;
  evidenceRepaired: number;
  attachmentsCreated: number;
  attachmentsSkipped: number;
  attachmentsRepaired: number;
  historicalContext: KnowledgePreview["historicalContext"];
  downgraded: KnowledgePreview["downgraded"];
};
type ImportResult = BaseImportResult | V2ImportResult;

async function readJson(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message ?? "请求失败，请稍后重试。");
  }
  return body.data;
}

function transferMode(file: File): TransferMode | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return "v1";
  if (name.endsWith(".zip")) return "v2";
  return null;
}

function previewValid(preview: Preview): boolean {
  return preview.summary.valid;
}

function baseSummary(preview: Preview): BaseSummary | null {
  return preview.mode === "v1" ? preview.summary : preview.summary.base;
}

function previewIssues(preview: Preview): Issue[] {
  return preview.mode === "v1" ? preview.summary.issues : preview.summary.issues;
}

function isV2Result(result: ImportResult): result is V2ImportResult {
  return "claimsCreated" in result;
}

function ObjectSummary({ label, value }: { label: string; value: ObjectPreview }) {
  return (
    <>
      <div><dt>{label}</dt><dd>{value.total} 个</dd></div>
      <div><dt>{label}新增</dt><dd>{value.toCreate} 个</dd></div>
      <div><dt>{label}跳过</dt><dd>{value.toSkip} 个</dd></div>
      <div><dt>{label}修复</dt><dd>{value.toRepair} 个</dd></div>
    </>
  );
}

export function DataTransferPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<
    "idle" | "previewing" | "ready" | "invalid" | "importing" | "completed"
  >("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setMessage("");
    setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function previewFile() {
    if (!file) return;
    const mode = transferMode(file);
    if (!mode) {
      setStage("invalid");
      setMessage("仅支持 KnowTrace .xlsx v1 或 .zip v2 文件。");
      return;
    }

    setStage("previewing");
    setMessage(
      mode === "v2"
        ? "正在校验 ZIP、附件哈希、知识链引用、重复项和数据库冲突……"
        : "正在读取工作表并检查格式、重复项和数据库冲突……",
    );
    const formData = new FormData();
    formData.set("file", file);
    try {
      const endpoint =
        mode === "v2"
          ? "/api/data-transfer/v2/import/preview"
          : "/api/data-transfer/import/preview";
      const data = await readJson(
        await fetch(endpoint, { method: "POST", body: formData }),
      );
      const nextPreview: Preview = { ...data, mode };
      setPreview(nextPreview);
      setStage(previewValid(nextPreview) ? "ready" : "invalid");
      setMessage(
        previewValid(nextPreview)
          ? mode === "v2"
            ? "v2 预检通过。可信状态将按安全策略降级，请核对数量后确认导入。"
            : "预检通过。请核对数量后再确认导入。"
          : "预检未通过。数据库尚未写入任何记录。",
      );
    } catch (error) {
      setStage("invalid");
      setMessage(error instanceof Error ? error.message : "预检失败。");
    }
  }

  async function confirmImport() {
    if (!preview || !previewValid(preview) || !preview.runId) return;
    setStage("importing");
    setMessage(
      preview.mode === "v2"
        ? "正在重新校验暂存包，并以单个数据库事务恢复知识链……"
        : "正在以单个数据库事务导入，请不要关闭页面……",
    );
    try {
      const endpoint =
        preview.mode === "v2"
          ? `/api/data-transfer/v2/import/${preview.runId}/confirm`
          : `/api/data-transfer/import/${preview.runId}/confirm`;
      const data = await readJson(await fetch(endpoint, { method: "POST" }));
      setResult(data.result as ImportResult);
      setStage("completed");
      setMessage(
        preview.mode === "v2"
          ? "v2 导入完成。知识链已按非受信任交换包策略恢复，可信状态需要重新核验。"
          : "导入完成。所有写入已一次性提交。",
      );
    } catch (error) {
      setStage("invalid");
      setMessage(error instanceof Error ? error.message : "导入失败，事务已回滚。");
    }
  }

  const busy = stage === "previewing" || stage === "importing";
  const base = preview ? baseSummary(preview) : null;
  const issues = preview ? previewIssues(preview) : [];
  const selectedMode = file ? transferMode(file) : null;
  const knowledge = preview?.mode === "v2" ? preview.summary.knowledge : null;

  return (
    <div className="data-transfer-grid">
      <section className="transfer-card">
        <div className="transfer-card-heading">
          <Download size={20} />
          <div>
            <h2>导出数据</h2>
            <p>按使用场景选择轻量 Excel 或包含知识链与图片的 v2 ZIP。</p>
          </div>
        </div>
        <ul className="transfer-rules">
          <li>Excel v1：记录、分类和关联，适合表格编辑</li>
          <li>ZIP v2：增加主张、证据、核验上下文、人工结论上下文和真实图片</li>
          <li>v2 是可编辑的非受信任交换包；可信状态不会被直接恢复</li>
        </ul>
        <div className="transfer-actions">
          <a className="button button-primary" href="/api/data-transfer/v2/export">
            <FileArchive size={15} /> 下载 v2 ZIP
          </a>
          <a className="button button-quiet" href="/api/data-transfer/export">
            <Download size={15} /> 下载 v1 Excel
          </a>
        </div>
      </section>

      <section className="transfer-card">
        <div className="transfer-card-heading">
          <Upload size={20} />
          <div>
            <h2>导入数据</h2>
            <p>支持 KnowTrace XLSX v1（最大 5 MB）和 ZIP v2（最大 256 MiB）。</p>
          </div>
        </div>
        <div className="import-steps" aria-label="导入步骤">
          <span className={stage !== "idle" ? "done" : "active"}>1 选择文件</span>
          <span className={stage === "ready" || stage === "invalid" || stage === "importing" || stage === "completed" ? "done" : ""}>2 预检</span>
          <span className={stage === "completed" ? "done" : stage === "ready" ? "active" : ""}>3 确认写入</span>
        </div>
        <label className="transfer-file-field">
          <span>
            KnowTrace 文件 <small>必填 · .xlsx v1 或 .zip v2</small>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
              setMessage("");
              setStage("idle");
            }}
          />
        </label>
        {file ? (
          <p className="transfer-hint">
            当前协议：{selectedMode === "v2" ? "v2 ZIP 知识链交换包" : selectedMode === "v1" ? "v1 Excel 基础交换表" : "不支持的文件类型"}
          </p>
        ) : null}
        <div className="transfer-actions">
          <button
            className="button button-dark"
            type="button"
            disabled={!file || busy || stage === "completed"}
            onClick={previewFile}
            aria-busy={stage === "previewing"}
          >
            {stage === "previewing" ? <LoaderCircle className="spin" size={15} /> : <FileSearch size={15} />}
            {stage === "previewing" ? "正在预检" : "开始预检"}
          </button>
          {stage !== "idle" ? (
            <button className="button button-quiet" type="button" disabled={busy} onClick={reset}>
              <RotateCcw size={15} /> 重新选择
            </button>
          ) : null}
        </div>

        {message ? (
          <div className={`transfer-status is-${stage}`} role="status" aria-live="polite">
            {stage === "previewing" || stage === "importing" ? (
              <LoaderCircle className="spin" size={17} />
            ) : stage === "ready" || stage === "completed" ? (
              <CheckCircle2 size={17} />
            ) : (
              <XCircle size={17} />
            )}
            <span>
              <strong>
                {stage === "ready" ? "等待确认" : stage === "completed" ? "导入成功" : stage === "invalid" ? "需要处理" : "处理中"}
              </strong>
              {message}
            </span>
          </div>
        ) : null}

        {preview ? (
          <div className="import-preview">
            <h3>预检结果 · {preview.mode === "v2" ? "ZIP v2" : "Excel v1"}</h3>
            {base ? (
              <dl>
                <div><dt>记录</dt><dd>{base.recordsTotal} 条</dd></div>
                <div><dt>新增</dt><dd>{base.recordsToCreate} 条</dd></div>
                <div><dt>重复跳过</dt><dd>{base.recordsToSkip} 条</dd></div>
                <div><dt>分类</dt><dd>{base.categoriesTotal} 个</dd></div>
                <div><dt>新建分类</dt><dd>{base.categoriesToCreate} 个</dd></div>
                <div><dt>复用分类</dt><dd>{base.categoriesToReuse} 个</dd></div>
                <div><dt>分类关联</dt><dd>{base.relationshipsTotal} 条</dd></div>
              </dl>
            ) : null}

            {knowledge ? (
              <>
                <h3>知识链计划</h3>
                <dl>
                  <ObjectSummary label="主张" value={knowledge.claims} />
                  <ObjectSummary label="证据" value={knowledge.evidence} />
                  <ObjectSummary label="图片" value={knowledge.attachments} />
                </dl>
                <div className="import-confirm">
                  <p>
                    <strong>安全降级：</strong>
                    主张可信状态 {knowledge.downgraded.claimTrustStates} 项；证据审核状态 {knowledge.downgraded.evidenceReviewStates} 项；来源核验状态 {knowledge.downgraded.evidenceCheckStates} 项；历史人工结论 {knowledge.downgraded.reviews} 项不会直接恢复为可信结论。
                  </p>
                  <p>
                    原包仍携带 {knowledge.historicalContext.sourceChecks + knowledge.historicalContext.attachmentChecks} 条核验上下文和 {knowledge.historicalContext.reviews} 条人工结论上下文，用于迁移审计，不作为当前可信状态。
                  </p>
                </div>
              </>
            ) : null}

            {issues.length ? (
              <div className="import-issues">
                <strong>需要修正的内容（{issues.length}）</strong>
                <ul>
                  {issues.slice(0, 20).map((issue, index) => (
                    <li key={`${issue.sheet}-${issue.row}-${issue.field}-${index}`}>
                      <span>{issue.sheet}{issue.row > 0 ? ` 第 ${issue.row} 行` : ""}</span>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {previewValid(preview) && stage !== "completed" ? (
              <div className="import-confirm">
                <p>
                  <strong>下一步条件：</strong>
                  {preview.mode === "v2"
                    ? "确认上述创建/跳过/修复计划以及可信状态降级。确认时会重新校验暂存 ZIP 和数据库状态；计划变化则拒绝写入。"
                    : `预检无错误；确认本次新增 ${base?.recordsToCreate ?? 0} 条记录。导入只新增或跳过，不覆盖已有内容。`}
                </p>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={stage !== "ready" || !preview.runId}
                  onClick={confirmImport}
                  aria-busy={stage === "importing"}
                >
                  {stage === "importing" ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}
                  {stage === "importing" ? "正在导入" : "确认导入"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div className="import-result">
            <strong>本次实际写入</strong>
            <span>
              新增记录 {result.recordsCreated} 条 · 跳过 {result.recordsSkipped} 条 · 新建分类 {result.categoriesCreated} 个 · 新增关联 {result.relationshipsCreated} 条
              {isV2Result(result)
                ? ` · 主张新增 ${result.claimsCreated}/跳过 ${result.claimsSkipped}/修复 ${result.claimsRepaired} · 证据新增 ${result.evidenceCreated}/跳过 ${result.evidenceSkipped}/修复 ${result.evidenceRepaired} · 图片新增 ${result.attachmentsCreated}/跳过 ${result.attachmentsSkipped}/修复 ${result.attachmentsRepaired}`
                : ""}
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
