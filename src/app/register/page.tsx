import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/register-form";
import { isRegistrationEnabled } from "@/features/auth/go-user-system";

export const metadata = { title: "注册" };

export default function RegisterPage() {
  if (!isRegistrationEnabled()) redirect("/login?registration=disabled");
  return (
    <main className="login-page">
      <RegisterForm />
    </main>
  );
}
