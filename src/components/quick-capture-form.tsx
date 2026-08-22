"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Sparkles } from "lucide-react";

import { createCaptureAction } from "@/app/actions";
import type { CategoryDTO } from "@/features/capture/queries";
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  type ContentType,
} from "@/features/capture/schema";

export function QuickCaptureForm({ categories }: { categories: CategoryDTO[] }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentType>("unknown");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggleCategory(id: string) {
    setCategoryIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      const result = await createCaptureAction({
        title: title || null,
        content,
        contentType,
        categoryIds,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!result.ok) {
        setMessage(
          result.error.fieldErrors?.content?.[0] ?? result.error.message,
        );
        return;
      }
      router.push(`/captures/${result.data.id}`);
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
        placeholder="输入关键词、想法片段、一次经历，或者一个还没想清楚的问题……"
        rows={6}
        value={content}
      />

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
          {message || `${content.length.toLocaleString()} / 20,000`}
        </span>
        <button className="button button-primary" disabled={isPending || !content.trim()} type="submit">
          {isPending ? "保存中…" : "保存并整理"} <ArrowUpRight size={16} />
        </button>
      </div>
    </form>
  );
}
