"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CalendarClock, Contact, RotateCcw, Save, Trash2 } from "lucide-react";

import {
  deleteCaptureAction,
  setCaptureCategoriesAction,
  setCaptureStatusAction,
  updateCaptureAction,
} from "@/app/actions";
import type { CaptureDetailDTO, CategoryDTO } from "@/features/capture/queries";
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  type ContentType,
} from "@/features/capture/schema";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "@/features/capture/datetime";

export function CaptureEditor({
  capture,
  categories,
  onDirtyChange,
}: {
  capture: CaptureDetailDTO;
  categories: CategoryDTO[];
  onDirtyChange: (hasUnsavedChanges: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(capture.title ?? "");
  const [subject, setSubject] = useState(capture.subject ?? "");
  const [occurredAt, setOccurredAt] = useState(() =>
    toDateTimeLocalValue(new Date(capture.occurredAt)),
  );
  const [content, setContent] = useState(capture.content);
  const [contentType, setContentType] = useState<ContentType>(capture.contentType);
  const [categoryIds, setCategoryIds] = useState(capture.categories.map(({ id }) => id));
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const initialOccurredAt = toDateTimeLocalValue(new Date(capture.occurredAt));
  const initialCategoryKey = capture.categories
    .map(({ id }) => id)
    .sort()
    .join("|");
  const currentCategoryKey = [...categoryIds].sort().join("|");
  const hasUnsavedChanges =
    title !== (capture.title ?? "") ||
    subject !== (capture.subject ?? "") ||
    occurredAt !== initialOccurredAt ||
    content !== capture.content ||
    contentType !== capture.contentType ||
    currentCategoryKey !== initialCategoryKey;

  useEffect(() => {
    onDirtyChange(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  function toggleCategory(id: string) {
    setCategoryIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      const occurredAtIso = dateTimeLocalToIso(occurredAt);
      if (!occurredAtIso) {
        setMessage("请选择有效的发生时间。");
        return;
      }
      const updateResult = await updateCaptureAction({
        id: capture.id,
        title: title || null,
        subject: subject || null,
        content,
        occurredAt: occurredAtIso,
        contentType,
        expectedVersion: capture.version,
      });
      if (!updateResult.ok) {
        setMessage(
          updateResult.error.fieldErrors?.subject?.[0] ??
            updateResult.error.fieldErrors?.occurredAt?.[0] ??
            updateResult.error.fieldErrors?.content?.[0] ??
            updateResult.error.message,
        );
        return;
      }
      const categoryResult = await setCaptureCategoriesAction({
        captureId: capture.id,
        categoryIds,
      });
      if (!categoryResult.ok) {
        setMessage(`内容已保存，但分类失败：${categoryResult.error.message}`);
        router.refresh();
        return;
      }
      setMessage("已保存，并创建了可追溯的版本记录。");
      router.refresh();
    });
  }

  function changeStatus() {
    startTransition(async () => {
      const next = capture.status === "active" ? "archived" : "active";
      const result = await setCaptureStatusAction({ id: capture.id, status: next });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      router.push(next === "archived" ? "/archived" : "/");
    });
  }

  function removeCapture() {
    const confirmed = window.confirm(
      "确定永久删除这条记录吗？原文、版本历史和 AI 处理记录都会一并删除，且无法恢复。",
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await deleteCaptureAction({ id: capture.id });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      window.location.replace("/");
    });
  }

  return (
    <form className="editor-card" onSubmit={save}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Source record · v{capture.version} · 创建者 {capture.createdByName}</p>
          <h2>原始记录</h2>
        </div>
        <span className={`record-status ${capture.status}`}>{capture.status === "active" ? "使用中" : "已归档"}</span>
      </div>

      <label className="field">
        <span>标题</span>
        <input maxLength={200} onChange={(event) => setTitle(event.target.value)} value={title} />
      </label>
      <div className="capture-context-grid">
        <label className="field">
          <span><Contact size={14} /> 描述对象</span>
          <input
            aria-label="描述对象"
            maxLength={200}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="例如：某公司、某个人、某个项目"
            value={subject}
          />
        </label>
        <label className="field">
          <span><CalendarClock size={14} /> 发生时间</span>
          <input
            aria-label="发生时间"
            onChange={(event) => setOccurredAt(event.target.value)}
            required
            step={60}
            type="datetime-local"
            value={occurredAt}
          />
        </label>
      </div>
      <label className="field">
        <span>原文</span>
        <textarea maxLength={20_000} onChange={(event) => setContent(event.target.value)} rows={12} value={content} />
        <small>{content.length.toLocaleString()} / 20,000</small>
      </label>
      <label className="field compact-field">
        <span>内容类型</span>
        <select onChange={(event) => setContentType(event.target.value as ContentType)} value={contentType}>
          {CONTENT_TYPES.map((type) => <option key={type} value={type}>{CONTENT_TYPE_LABELS[type]}</option>)}
        </select>
      </label>

      <fieldset className="field category-fieldset">
        <legend>分类</legend>
        {categories.length === 0 ? (
          <p className="muted">请先从左侧新建一个分类。</p>
        ) : (
          <div className="checkbox-grid">
            {categories.map((category) => (
              <label key={category.id}>
                <input
                  checked={categoryIds.includes(category.id)}
                  onChange={() => toggleCategory(category.id)}
                  type="checkbox"
                />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="editor-actions">
        <button className="button button-danger" disabled={isPending} onClick={removeCapture} type="button">
          <Trash2 size={16} /> 永久删除
        </button>
        <button className="button button-quiet" disabled={isPending} onClick={changeStatus} type="button">
          {capture.status === "active" ? <Archive size={16} /> : <RotateCcw size={16} />}
          {capture.status === "active" ? "归档" : "恢复"}
        </button>
        <span className={message.startsWith("已保存") ? "form-success" : message ? "form-error" : hasUnsavedChanges ? "form-unsaved" : "form-saved"}>
          {message || (hasUnsavedChanges ? "有未保存修改，AI 暂时不会分析这些内容。" : `已保存版本 v${capture.version}`)}
        </span>
        <button className="button button-primary" disabled={isPending || !content.trim()} id="capture-save-button" type="submit">
          <Save size={16} /> {isPending ? "处理中…" : "保存修改"}
        </button>
      </div>
    </form>
  );
}
