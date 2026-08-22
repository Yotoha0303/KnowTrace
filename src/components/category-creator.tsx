"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { createCategoryAction } from "@/app/actions";

export function CategoryCreator() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await createCategoryAction({ name });
      if (result.ok) {
        setName("");
        setMessage("");
        router.refresh();
      } else {
        setMessage(result.error.message);
      }
    });
  }

  return (
    <form className="category-create" onSubmit={submit}>
      <input
        aria-label="新分类名称"
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        placeholder="新建分类"
        value={name}
      />
      <button aria-label="创建分类" disabled={isPending || !name.trim()} type="submit">
        <Plus size={16} />
      </button>
      {message ? <small className="form-error">{message}</small> : null}
    </form>
  );
}
