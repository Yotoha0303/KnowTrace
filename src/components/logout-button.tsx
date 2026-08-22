"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className="sidebar-logout" disabled={pending} onClick={logout} type="button">
      <LogOut size={14} /> {pending ? "正在退出…" : "退出登录"}
    </button>
  );
}
