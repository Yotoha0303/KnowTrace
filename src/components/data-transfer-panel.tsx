"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Download, FileSearch, LoaderCircle, RotateCcw, Upload, XCircle } from "lucide-react";

type Issue = { sheet: string; row: number; field: string; message: string };
type Preview = {
  runId: string;
  status: "previewed" | "failed";
  summary: {
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
};
type ImportResult = { recordsCreated: number; recordsSkipped: number; categoriesCreated: number; categoriesReused: number; relationshipsCreated: number };

async function readJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败，请稍后重试。");
  return body.data;
}

export function DataTransferPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"idle" | "previewing" | "ready" | "invalid" | "importing" | "completed">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");

  function reset() {
    setFile(null); setPreview(null); setResult(null); setMessage(""); setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function previewFile() {
    if (!file) return;
    setStage("previewing"); setMessage("正在读取工作表并检查格式、重复项和数据库冲突……");
    const formData = new FormData(); formData.set("file", file);
    try {
      const data = await readJson(await fetch("/api/data-transfer/import/preview", { method: "POST", body: formData })) as Preview;
      setPreview(data);
      setStage(data.summary.valid ? "ready" : "invalid");
      setMessage(data.summary.valid ? "预检通过。请核对数量后再确认导入。" : "预检未通过。数据库尚未写入任何记录。");
    } catch (error) {
      setStage("invalid"); setMessage(error instanceof Error ? error.message : "预检失败。");
    }
  }

  async function confirmImport() {
    if (!preview?.summary.valid) return;
    setStage("importing"); setMessage("正在以单个数据库事务导入，请不要关闭页面……");
    try {
      const data = await readJson(await fetch(`/api/data-transfer/import/${preview.runId}/confirm`, { method: "POST" }));
      setResult(data.result as ImportResult); setStage("completed"); setMessage("导入完成。所有写入已一次性提交。");
    } catch (error) {
      setStage("invalid"); setMessage(error instanceof Error ? error.message : "导入失败，事务已回滚。");
    }
  }

  const busy = stage === "previewing" || stage === "importing";
  return (
    <div className="data-transfer-grid">
      <section className="transfer-card">
        <div className="transfer-card-heading"><Download size={20} /><div><h2>导出 Excel</h2><p>生成当前全部记录、分类和关联的 .xlsx 文件。</p></div></div>
        <ul className="transfer-rules"><li>包含启用和已归档记录</li><li>保留描述对象与发生时间</li><li>文件内附格式说明和可编辑下拉项</li></ul>
        <a className="button button-primary" href="/api/data-transfer/export"><Download size={15} /> 下载 Excel</a>
      </section>

      <section className="transfer-card">
        <div className="transfer-card-heading"><Upload size={20} /><div><h2>导入 Excel</h2><p>仅接受 KnowTrace XLSX 格式 v1，最大 5 MB。</p></div></div>
        <div className="import-steps" aria-label="导入步骤"><span className={stage !== "idle" ? "done" : "active"}>1 选择文件</span><span className={stage === "ready" || stage === "invalid" || stage === "importing" || stage === "completed" ? "done" : ""}>2 预检</span><span className={stage === "completed" ? "done" : stage === "ready" ? "active" : ""}>3 确认写入</span></div>
        <label className="transfer-file-field"><span>Excel 文件 <small>必填 · .xlsx · 1 B–5 MB</small></span><input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setResult(null); setMessage(""); setStage("idle"); }} /></label>
        <div className="transfer-actions">
          <button className="button button-dark" type="button" disabled={!file || busy || stage === "completed"} onClick={previewFile} aria-busy={stage === "previewing"}>{stage === "previewing" ? <LoaderCircle className="spin" size={15} /> : <FileSearch size={15} />} {stage === "previewing" ? "正在预检" : "开始预检"}</button>
          {stage !== "idle" ? <button className="button button-quiet" type="button" disabled={busy} onClick={reset}><RotateCcw size={15} /> 重新选择</button> : null}
        </div>

        {message ? <div className={`transfer-status is-${stage}`} role="status" aria-live="polite">{stage === "previewing" || stage === "importing" ? <LoaderCircle className="spin" size={17} /> : stage === "ready" || stage === "completed" ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<span><strong>{stage === "ready" ? "等待确认" : stage === "completed" ? "导入成功" : stage === "invalid" ? "需要处理" : "处理中"}</strong>{message}</span></div> : null}

        {preview ? <div className="import-preview"><h3>预检结果</h3><dl><div><dt>记录</dt><dd>{preview.summary.recordsTotal} 条</dd></div><div><dt>新增</dt><dd>{preview.summary.recordsToCreate} 条</dd></div><div><dt>重复跳过</dt><dd>{preview.summary.recordsToSkip} 条</dd></div><div><dt>分类</dt><dd>{preview.summary.categoriesTotal} 个</dd></div><div><dt>新建分类</dt><dd>{preview.summary.categoriesToCreate} 个</dd></div><div><dt>复用分类</dt><dd>{preview.summary.categoriesToReuse} 个</dd></div><div><dt>分类关联</dt><dd>{preview.summary.relationshipsTotal} 条</dd></div></dl>
          {preview.summary.issues.length ? <div className="import-issues"><strong>需要修正的内容（{preview.summary.issues.length}）</strong><ul>{preview.summary.issues.slice(0, 20).map((issue, index) => <li key={`${issue.sheet}-${issue.row}-${issue.field}-${index}`}><span>{issue.sheet}{issue.row > 0 ? ` 第 ${issue.row} 行` : ""}</span>{issue.message}</li>)}</ul></div> : null}
          {preview.summary.valid && stage !== "completed" ? <div className="import-confirm"><p><strong>下一步条件：</strong>预检无错误；确认本次新增 {preview.summary.recordsToCreate} 条记录。导入只新增或跳过，不覆盖已有内容。</p><button className="button button-primary" type="button" disabled={stage !== "ready"} onClick={confirmImport} aria-busy={stage === "importing"}>{stage === "importing" ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />} {stage === "importing" ? "正在导入" : "确认导入"}</button></div> : null}
        </div> : null}
        {result ? <div className="import-result"><strong>本次实际写入</strong><span>新增记录 {result.recordsCreated} 条 · 跳过 {result.recordsSkipped} 条 · 新建分类 {result.categoriesCreated} 个 · 新增关联 {result.relationshipsCreated} 条</span></div> : null}
      </section>
    </div>
  );
}
