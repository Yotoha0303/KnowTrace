"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, LoaderCircle, LogIn } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("正在检查已有会话……");
  const [submitting, setSubmitting] = useState(false);
  const nextPath = searchParams.get("next");
  const destination = nextPath?.startsWith("/") && !nextPath.startsWith("//")
    ? nextPath
    : "/";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/refresh", {
      method: "POST",
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok) {
          router.replace(destination);
          router.refresh();
          return;
        }
        setMessage("请输入 go-user-system 的账号和密码。");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage("登录服务暂时不可用，你仍可以稍后重试。");
      });
    return () => controller.abort();
  }, [destination, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setMessage("正在验证账号……");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        setMessage(payload?.error?.message || "登录失败，请检查账号和密码。");
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setMessage("无法连接登录服务，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <span className="brand-mark">K</span>
      <p className="eyebrow">Protected workspace</p>
      <h1>登录 KnowTrace</h1>
      <p>账号与会话由独立的 go-user-system 管理，KnowTrace 不保存密码。</p>
      <label>
        用户名
        <input autoComplete="username" autoFocus maxLength={255} onChange={(event) => setUsername(event.target.value)} required value={username} />
      </label>
      <label>
        密码
        <span className="input-with-icon">
          <KeyRound size={16} />
          <input autoComplete="current-password" maxLength={72} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        </span>
      </label>
      <button className="button button-primary" disabled={submitting} type="submit">
        {submitting ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}
        {submitting ? "正在登录…" : "登录"}
      </button>
      <p aria-live="polite" className="login-message">{message}</p>
    </form>
  );
}
