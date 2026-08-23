"use client";

import { useState, useTransition } from "react";
import { Archive, RotateCcw, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  deleteCategoryAction,
  renameCategoryAction,
  setCategoryStatusAction,
} from "@/app/actions";
import type { CategoryDTO } from "@/features/capture/queries";

function CategoryRow({ category }: { category: CategoryDTO }) {
  const router = useRouter();
  const [name, setName] = useState(category.name);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const archivedCaptureCount = Math.max(
    category.captureCount - category.activeCaptureCount,
    0,
  );

  function rename() {
    if (!name.trim() || name.trim() === category.name) return;
    startTransition(async () => {
      const result = await renameCategoryAction({ id: category.id, name });
      setMessage(result.ok ? "已保存" : result.error.message);
    });
  }

  function toggleStatus() {
    startTransition(async () => {
      const result = await setCategoryStatusAction({
        id: category.id,
        status: category.status === "active" ? "archived" : "active",
      });
      setMessage(result.ok ? "状态已更新" : result.error.message);
    });
  }

  function remove() {
    if (category.captureCount !== 0) return;
    if (!window.confirm(`确定永久删除空分类“${category.name}”吗？此操作不可恢复。`)) {
      return;
    }
    setMessage("");
    startTransition(async () => {
      const result = await deleteCategoryAction({ id: category.id });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <article className="category-manage-row">
      <div>
        <input aria-label={`${category.name}的名称`} maxLength={60} onChange={(event) => setName(event.target.value)} value={name} />
        <p aria-label={`${category.name}记录统计`}>
          使用中 {category.activeCaptureCount} 条 · 已归档 {archivedCaptureCount} 条 · 共 {category.captureCount} 条
          <br />
          分类状态：{category.status === "active" ? "使用中" : "已归档"}
          <br />
          创建者：{category.createdByName}
        </p>
      </div>
      <span className={message === "已保存" || message === "状态已更新" ? "form-success" : "form-error"}>{message}</span>
      <button className="button button-quiet" disabled={isPending || !name.trim() || name.trim() === category.name} onClick={rename} type="button"><Save size={15} /> 保存名称</button>
      <button className="button button-quiet" disabled={isPending} onClick={toggleStatus} type="button">
        {category.status === "active" ? <Archive size={15} /> : <RotateCcw size={15} />}
        {category.status === "active" ? "归档" : "恢复"}
      </button>
      <button
        className="button button-danger"
        disabled={isPending || category.captureCount !== 0}
        onClick={remove}
        title={category.captureCount === 0 ? "永久删除空分类" : "仍有关联记录，不能删除"}
        type="button"
      >
        <Trash2 size={15} /> 删除
      </button>
    </article>
  );
}

export function CategoryManager({ categories }: { categories: CategoryDTO[] }) {
  return (
    <div className="category-manager">
      {categories.map((category) => <CategoryRow category={category} key={`${category.id}-${category.name}-${category.status}`} />)}
    </div>
  );
}
