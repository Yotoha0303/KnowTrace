"use client";

import { useActionState } from "react";
import {
  BadgeCheck,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  UserCog,
} from "lucide-react";

import {
  assignRolesAction,
  changePasswordAction,
  updateProfileAction,
  type AccountActionState,
} from "@/app/account/actions";
import {
  GO_PERMISSION,
  type AuthUser,
  type AuthorizationInfo,
  type Permission,
  type Role,
} from "@/features/auth/go-user-system";

type Props = {
  adminLoadError: string | null;
  authorization: AuthorizationInfo;
  notice: string | null;
  permissions: Permission[] | null;
  roles: Role[] | null;
  user: AuthUser;
};

const initialState: AccountActionState = { status: "idle", message: "" };

export function AccountCenter({
  adminLoadError,
  authorization,
  notice,
  permissions,
  roles,
  user,
}: Props) {
  const [profileState, profileAction, profilePending] = useActionState(
    updateProfileAction,
    initialState,
  );
  const [passwordState, passwordAction, passwordPending] = useActionState(
    changePasswordAction,
    initialState,
  );
  const [rolesState, rolesAction, rolesPending] = useActionState(
    assignRolesAction,
    initialState,
  );
  const canUpdateProfile = authorization.permission_codes.includes(GO_PERMISSION.profileUpdate);
  const canUpdatePassword = authorization.permission_codes.includes(GO_PERMISSION.passwordUpdate);
  const canAssignRoles = authorization.permission_codes.includes(GO_PERMISSION.adminUserRolesUpdate);

  return (
    <div className="page-shell account-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">go-user-system</p>
          <h1>账户中心</h1>
          <p className="page-intro">账号、密码与权限由独立认证服务统一管理；KnowTrace 只保存登录会话 Cookie。</p>
        </div>
        <span className="status-pill"><span />认证服务已接入</span>
      </header>

      {notice ? <p className="account-notice" role="status">{notice}</p> : null}

      <section className="account-summary" aria-label="账户摘要">
        <div>
          <small>用户 ID</small>
          <strong>#{user.id}</strong>
        </div>
        <div>
          <small>用户名</small>
          <strong>@{user.username}</strong>
        </div>
        <div>
          <small>昵称</small>
          <strong>{user.nickname || "未设置"}</strong>
        </div>
        <div>
          <small>最近登录</small>
          <strong>{formatLoginTime(user.last_login_at)}</strong>
        </div>
      </section>

      <div className="account-grid">
        <section className="account-card">
          <div className="account-card-heading">
            <BadgeCheck size={20} />
            <div><h2>个人资料</h2><p>当前版本仅支持修改昵称，用户名不可在此更改。</p></div>
          </div>
          <form action={profileAction} className="account-form">
            <label className="field">
              <span>昵称</span>
              <input defaultValue={user.nickname} disabled={!canUpdateProfile} maxLength={64} name="nickname" required />
              <small>必填，最多 64 字节；中文通常最多约 21 个字。</small>
              <FieldError errors={profileState.fieldErrors?.nickname} />
            </label>
            <ActionMessage state={profileState} />
            <button aria-busy={profilePending} className="button button-primary" disabled={profilePending || !canUpdateProfile} type="submit">
              {profilePending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {profilePending ? "正在保存…" : "保存昵称"}
            </button>
          </form>
        </section>

        <section className="account-card">
          <div className="account-card-heading">
            <KeyRound size={20} />
            <div><h2>修改密码</h2><p>成功后 go-user-system 会使该账号的全部现有会话失效。</p></div>
          </div>
          <form action={passwordAction} className="account-form">
            <PasswordField autoComplete="current-password" errors={passwordState.fieldErrors?.oldPassword} label="当前密码" name="oldPassword" />
            <PasswordField autoComplete="new-password" errors={passwordState.fieldErrors?.newPassword} help="必填，至少 12 个字符、最多 72 字节，且不能与当前密码相同。" label="新密码" minLength={12} name="newPassword" />
            <PasswordField autoComplete="new-password" errors={passwordState.fieldErrors?.newPasswordConfirm} help="必填，必须与新密码一致。" label="确认新密码" minLength={12} name="newPasswordConfirm" />
            <p className="account-warning">保存后当前页面会退出登录，其他设备也必须重新登录。</p>
            <ActionMessage state={passwordState} />
            <button aria-busy={passwordPending} className="button button-dark" disabled={passwordPending || !canUpdatePassword} type="submit">
              {passwordPending ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
              {passwordPending ? "正在修改并注销会话…" : "修改密码并退出全部会话"}
            </button>
          </form>
        </section>
      </div>

      <section className="account-card account-authorization">
        <div className="account-card-heading">
          <ShieldCheck size={20} />
          <div><h2>我的角色与权限</h2><p>这些权限来自 go-user-system；目前它们不等同于 KnowTrace 的 Workspace 数据隔离。</p></div>
        </div>
        <div className="authorization-columns">
          <div><h3>角色</h3><CodeList empty="当前账号没有角色" values={authorization.role_codes} /></div>
          <div><h3>权限</h3><CodeList empty="当前账号没有权限" values={authorization.permission_codes} /></div>
        </div>
      </section>

      {canAssignRoles ? (
        <section className="account-card account-admin">
          <div className="account-card-heading">
            <UserCog size={20} />
            <div><h2>管理员：分配角色</h2><p>当前 go-user-system 尚无用户列表接口，请输入目标账号的数字用户 ID。</p></div>
          </div>
          {adminLoadError ? <p className="form-error">角色目录加载失败：{adminLoadError}</p> : null}
          {roles ? (
            <form action={rolesAction} className="account-form admin-role-form">
              <label className="field">
                <span>目标用户 ID</span>
                <input inputMode="numeric" min={1} name="userId" pattern="[0-9]+" placeholder="例如：12" required type="number" />
                <small>必填，只接受正整数。可在目标用户自己的账户摘要中查看 ID。</small>
                <FieldError errors={rolesState.fieldErrors?.userId} />
              </label>
              <fieldset className="role-picker">
                <legend>角色（至少选择一个）</legend>
                {roles.map((role) => (
                  <label key={role.id}>
                    <input name="roleCodes" type="checkbox" value={role.code} />
                    <span><strong>{role.name}</strong><small>{role.code}</small></span>
                  </label>
                ))}
                <FieldError errors={rolesState.fieldErrors?.roleCodes} />
              </fieldset>
              <label className="role-confirmation">
                <input name="confirmRoles" required type="checkbox" value="yes" />
                <span>我已确认：保存会覆盖目标用户的全部现有角色；若填写自己的 ID，可能移除自己的管理员权限。</span>
              </label>
              <FieldError errors={rolesState.fieldErrors?.confirmRoles} />
              <ActionMessage state={rolesState} />
              <button aria-busy={rolesPending} className="button button-primary" disabled={rolesPending} type="submit">
                {rolesPending ? <LoaderCircle className="spin" size={16} /> : <UserCog size={16} />}
                {rolesPending ? "正在更新角色…" : "保存角色分配"}
              </button>
            </form>
          ) : null}

          {permissions ? (
            <details className="permission-catalog">
              <summary>查看完整权限目录（{permissions.length} 项）</summary>
              <ul>{permissions.map((permission) => <li key={permission.id}><code>{permission.code}</code><span>{permission.name}</span><small>{permission.method} {permission.path}</small></li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <p className="account-boundary">当前认证服务未提供设备会话列表或按设备撤销接口；已支持退出当前会话，以及通过修改密码使全部会话失效。</p>
    </div>
  );
}

function PasswordField({ autoComplete, errors, help = "必填。", label, minLength, name }: { autoComplete: string; errors?: string[]; help?: string; label: string; minLength?: number; name: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input autoComplete={autoComplete} minLength={minLength} name={name} required type="password" />
      <small>{help}</small>
      <FieldError errors={errors} />
    </label>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.[0] ? <small className="field-error">{errors[0]}</small> : null;
}

function ActionMessage({ state }: { state: { status: string; message: string } }) {
  return state.message ? <p aria-live="polite" className={state.status === "error" ? "form-error" : "form-success"}>{state.message}</p> : null;
}

function CodeList({ empty, values }: { empty: string; values: string[] }) {
  return values.length ? <div className="code-list">{values.map((value) => <code key={value}>{value}</code>)}</div> : <p className="muted-copy">{empty}</p>;
}

function formatLoginTime(value?: string) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(date);
}
