import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <Suspense fallback={<div className="login-card">正在准备登录页面……</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
