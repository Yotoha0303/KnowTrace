import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";
import { isRegistrationEnabled } from "@/features/auth/go-user-system";

export default function LoginPage() {
  return (
    <main className="login-page">
      <Suspense fallback={<div className="login-card">正在准备登录页面……</div>}>
        <LoginForm registrationEnabled={isRegistrationEnabled()} />
      </Suspense>
    </main>
  );
}
