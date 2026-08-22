"use client";

import Link from "next/link";
import { useActionState } from "react";
import { KeyRound, LoaderCircle, UserPlus } from "lucide-react";

import {
  registerAccountAction,
  type AccountActionState,
} from "@/app/account/actions";

const initialState: AccountActionState = { status: "idle", message: "" };

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(
    registerAccountAction,
    initialState,
  );

  return (
    <form action={formAction} className="login-card">
      <span className="brand-mark">K</span>
      <p className="eyebrow">go-user-system account</p>
      <h1>创建账号</h1>
      <p>账号与密码只提交到 go-user-system，KnowTrace 不保存密码。</p>

      <label>
        用户名 <small>必填，3–64 个字符</small>
        <input autoComplete="username" autoFocus maxLength={64} minLength={3} name="username" required />
        <FieldError errors={state.fieldErrors?.username} />
      </label>
      <label>
        密码 <small>必填，至少 12 个字符且最多 72 字节</small>
        <span className="input-with-icon">
          <KeyRound size={16} />
          <input autoComplete="new-password" minLength={12} name="password" required type="password" />
        </span>
        <FieldError errors={state.fieldErrors?.password} />
      </label>
      <label>
        确认密码 <small>必填，必须与上方一致</small>
        <span className="input-with-icon">
          <KeyRound size={16} />
          <input autoComplete="new-password" minLength={12} name="passwordConfirm" required type="password" />
        </span>
        <FieldError errors={state.fieldErrors?.passwordConfirm} />
      </label>

      <button aria-busy={pending} className="button button-primary" disabled={pending} type="submit">
        {pending ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}
        {pending ? "正在创建账号…" : "创建账号"}
      </button>
      <p aria-live="polite" className={`login-message ${state.status === "error" ? "form-error" : ""}`}>
        {state.message}
      </p>
      <Link className="auth-switch-link" href="/login">已有账号？返回登录</Link>
    </form>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.[0] ? <small className="field-error">{errors[0]}</small> : null;
}
