"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  assignGoUserRoles,
  GO_PERMISSION,
  isRegistrationEnabled,
  registerWithGoUserSystem,
  updateGoUserPassword,
  updateGoUserProfile,
} from "@/features/auth/go-user-system";
import {
  clearCurrentSessionCookies,
  currentAuthContext,
} from "@/features/auth/session";

export type AccountActionState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

function passwordSchema(label: string) {
  return z.string().min(12, `${label}至少需要 12 个字符。`).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    `${label}不能超过 72 字节（中文通常占 3 字节）。`,
  );
}

const registrationSchema = z.object({
  username: z.string().trim().min(3, "用户名至少需要 3 个字符。").max(64, "用户名最多 64 个字符。"),
  password: passwordSchema("密码"),
  passwordConfirm: z.string(),
}).superRefine((value, context) => {
  if (value.password !== value.passwordConfirm) {
    context.addIssue({
      code: "custom",
      message: "两次输入的密码不一致。",
      path: ["passwordConfirm"],
    });
  }
});

const profileSchema = z.object({
  nickname: z.string().trim().min(1, "昵称为必填项。").refine(
    (value) => Buffer.byteLength(value, "utf8") <= 64,
    "昵称不能超过 64 字节（中文通常最多约 21 个字）。",
  ),
});

const passwordChangeSchema = z.object({
  oldPassword: z.string().min(1, "当前密码为必填项。"),
  newPassword: passwordSchema("新密码"),
  newPasswordConfirm: z.string(),
}).superRefine((value, context) => {
  if (value.newPassword !== value.newPasswordConfirm) {
    context.addIssue({
      code: "custom",
      message: "两次输入的新密码不一致。",
      path: ["newPasswordConfirm"],
    });
  }
  if (value.oldPassword === value.newPassword) {
    context.addIssue({
      code: "custom",
      message: "新密码必须与当前密码不同。",
      path: ["newPassword"],
    });
  }
});

const roleAssignmentSchema = z.object({
  userId: z.string().trim().regex(/^\d+$/, "用户 ID 必须是正整数。").transform(Number).pipe(z.number().int().positive("用户 ID 必须是正整数。")),
  roleCodes: z.array(z.string().trim().min(1)).min(1, "至少选择一个角色。"),
  confirmRoles: z.literal("yes", { error: "请确认角色列表会覆盖目标用户的现有角色。" }),
});

function formDataFields(formData: FormData, names: string[]) {
  return Object.fromEntries(names.map((name) => [name, formData.get(name)]));
}

function validationFailure(error: z.ZodError): AccountActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }
  return { status: "error", message: "请先修正表单中的问题。", fieldErrors };
}

function upstreamFailure(message: string): AccountActionState {
  return { status: "error", message };
}

async function authorizedContext(permission: string) {
  const context = await currentAuthContext();
  if (!context) return { context: null, error: "登录会话已失效，请重新登录。" };
  if (!context.authorization.permission_codes.includes(permission)) {
    return { context: null, error: "当前账号没有执行此操作的权限。" };
  }
  return { context, error: null };
}

export async function registerAccountAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  if (!isRegistrationEnabled()) {
    return upstreamFailure("当前部署未开放注册，请联系管理员创建账号。");
  }
  const parsed = registrationSchema.safeParse(
    formDataFields(formData, ["username", "password", "passwordConfirm"]),
  );
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await registerWithGoUserSystem({
    username: parsed.data.username,
    password: parsed.data.password,
  });
  if (!result.ok) return upstreamFailure(result.message);
  redirect("/login?registered=1");
}

export async function updateProfileAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const auth = await authorizedContext(GO_PERMISSION.profileUpdate);
  if (!auth.context) return upstreamFailure(auth.error);
  const parsed = profileSchema.safeParse(formDataFields(formData, ["nickname"]));
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await updateGoUserProfile(auth.context.accessToken, parsed.data);
  if (!result.ok) return upstreamFailure(result.message);
  redirect("/account?profile=updated");
}

export async function changePasswordAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const auth = await authorizedContext(GO_PERMISSION.passwordUpdate);
  if (!auth.context) return upstreamFailure(auth.error);
  const parsed = passwordChangeSchema.safeParse(
    formDataFields(formData, ["oldPassword", "newPassword", "newPasswordConfirm"]),
  );
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await updateGoUserPassword(auth.context.accessToken, {
    old_password: parsed.data.oldPassword,
    new_password: parsed.data.newPassword,
  });
  if (!result.ok) return upstreamFailure(result.message);

  await clearCurrentSessionCookies();
  redirect("/login?passwordChanged=1");
}

export async function assignRolesAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const auth = await authorizedContext(GO_PERMISSION.adminUserRolesUpdate);
  if (!auth.context) return upstreamFailure(auth.error);
  const parsed = roleAssignmentSchema.safeParse({
    userId: formData.get("userId"),
    roleCodes: formData.getAll("roleCodes"),
    confirmRoles: formData.get("confirmRoles"),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await assignGoUserRoles(
    auth.context.accessToken,
    parsed.data.userId,
    parsed.data.roleCodes,
  );
  if (!result.ok) return upstreamFailure(result.message);
  return {
    status: "success",
    message: `已更新用户 #${parsed.data.userId} 的角色。新的权限会在其下一次请求时生效。`,
  };
}
