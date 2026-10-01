"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, CalendarClock, Check, Contact, Sparkles } from "lucide-react";

import { createCaptureAction } from "@/app/actions";
import type { CategoryDTO } from "@/features/capture/queries";
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  type ContentType,
} from "@/features/capture/schema";
import { dateTimeLocalToIso } from "@/features/capture/datetime";

function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  return `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function QuickCaptureForm({
  categories,
  defaultOccurredAt,
}: {
  categories: CategoryDTO[];
  defaultOccurredAt: string;
}) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt);
  const [contentType, setContentType] = useState<ContentType>("unknown");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  // 「能不能提交」的**唯一判据**，按钮与快捷键共用。
  //
  // 为什么必须共用：`form.requestSubmit()` 不带参数时**会绕过提交按钮的 disabled**，
  // 所以空内容按快捷键也会触发提交——这是 2026-10-01 写测试时才抓到的真实缺陷
  // （测试「空内容不提交」失败）。把条件抽出来，两处引用同一个值就不会再漂移。
  const canSubmit = !isPending && content.trim().length > 0;

  function toggleCategory(id: string) {
    setCategoryIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      const occurredAtIso = dateTimeLocalToIso(occurredAt);
      if (!occurredAtIso) {
        setMessage("请选择有效的发生时间。");
        return;
      }
      const result = await createCaptureAction({
        title: title || null,
        subject: subject || null,
        content,
        occurredAt: occurredAtIso,
        contentType,
        categoryIds,
        idempotencyKey: createIdempotencyKey(),
      });
      if (!result.ok) {
        setMessage(
          result.error.fieldErrors?.subject?.[0] ??
            result.error.fieldErrors?.occurredAt?.[0] ??
            result.error.fieldErrors?.content?.[0] ??
            result.error.message,
        );
        return;
      }
      window.location.replace(`/captures/${result.data.id}`);
    });
  }

  return (
    <form className="capture-composer" onSubmit={submit}>
      <div className="composer-kicker">
        <Sparkles size={15} /> 快速记录
      </div>
      <input
        className="composer-title"
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="标题可以稍后再补"
        value={title}
      />
      <textarea
        autoFocus
        maxLength={20_000}
        onChange={(event) => setContent(event.target.value)}
        // Ctrl/Cmd + Enter 提交。用 requestSubmit 而不是直接调 submit()，
        // 这样走的是与点按钮**完全相同**的路径（含原生校验与 disabled 状态）。
        //
        // 为什么加：docs/02-user-flows.md:20 一直写着「点击保存/使用快捷键」，
        // 但 2026-10-01 全仓库检索确认**没有任何快捷键实现**。
        // 「先保存，后整理」是产品原则第 1 条，入口越省力越符合定位。
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (canSubmit) event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder="输入关键词、想法片段、一次经历，或者一个还没想清楚的问题……"
        rows={6}
        value={content}
      />

      <div className="capture-context-fields">
        <label>
          <span><Contact size={14} /> 描述对象</span>
          <input
            aria-label="描述对象"
            maxLength={200}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="例如：某公司、某个人、某个项目"
            value={subject}
          />
        </label>
        <label>
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

      <div className="composer-options">
        <label>
          <span>内容类型</span>
          <select
            onChange={(event) => setContentType(event.target.value as ContentType)}
            value={contentType}
          >
            {CONTENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONTENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        {categories.length ? (
          <details className="category-picker">
            <summary>
              分类 {categoryIds.length ? `· ${categoryIds.length}` : ""}
            </summary>
            <div className="category-picker-menu">
              {categories.map((category) => (
                <button
                  className={categoryIds.includes(category.id) ? "selected" : ""}
                  key={category.id}
                  onClick={() => toggleCategory(category.id)}
                  type="button"
                >
                  <Check size={14} /> {category.name}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <div className="composer-footer">
        <span className={message ? "form-error" : "composer-hint"}>
          {message || `${content.length.toLocaleString()} / 20,000 · Ctrl/⌘ + Enter 保存`}
        </span>
        <button className="button button-primary" disabled={!canSubmit} type="submit">
          {isPending ? "保存中…" : "保存并整理"} <ArrowUpRight size={16} />
        </button>
      </div>
    </form>
  );
}
