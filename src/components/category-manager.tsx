"use client";

import { useState, useTransition } from "react";
import { Archive, RotateCcw, Save } from "lucide-react";

import { renameCategoryAction, setCategoryStatusAction } from "@/app/actions";
import type { CategoryDTO } from "@/features/capture/queries";

function CategoryRow({ category }: { category: CategoryDTO }) {
  const [name, setName] = useState(category.name);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

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

  return (
    <article className="category-manage-row">
      <div>
        <input aria-label={`${category.name}的名称`} maxLength={60} onChange={(event) => setName(event.target.value)} value={name} />
        <p>{category.captureCount} 条记录 · {category.status === "active" ? "使用中" : "已归档"}</p>
      </div>
      <span className={message === "已保存" || message === "状态已更新" ? "form-success" : "form-error"}>{message}</span>
      <button className="button button-quiet" disabled={isPending || !name.trim() || name.trim() === category.name} onClick={rename} type="button"><Save size={15} /> 保存名称</button>
      <button className="button button-quiet" disabled={isPending} onClick={toggleStatus} type="button">
        {category.status === "active" ? <Archive size={15} /> : <RotateCcw size={15} />}
        {category.status === "active" ? "归档" : "恢复"}
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
