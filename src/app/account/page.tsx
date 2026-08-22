import { redirect } from "next/navigation";

import { AccountCenter } from "@/components/account-center";
import {
  GO_PERMISSION,
  isAuthEnabled,
  listGoPermissions,
  listGoRoles,
} from "@/features/auth/go-user-system";
import { currentAuthContext } from "@/features/auth/session";

export const metadata = { title: "账户中心" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string | string[] }>;
}) {
  if (!isAuthEnabled()) redirect("/");
  const [context, params] = await Promise.all([
    currentAuthContext(),
    searchParams,
  ]);
  if (!context) redirect("/login?next=%2Faccount");

  const canReadRoles = context.authorization.permission_codes.includes(
    GO_PERMISSION.adminRolesRead,
  );
  const canReadPermissions = context.authorization.permission_codes.includes(
    GO_PERMISSION.adminPermissionsRead,
  );
  const [rolesResult, permissionsResult] = await Promise.all([
    canReadRoles ? listGoRoles(context.accessToken) : Promise.resolve(null),
    canReadPermissions
      ? listGoPermissions(context.accessToken)
      : Promise.resolve(null),
  ]);

  const adminLoadErrors = [rolesResult, permissionsResult]
    .filter((result) => result && !result.ok)
    .map((result) => result && !result.ok ? result.message : "")
    .filter(Boolean);
  const profileUpdated = params.profile === "updated";

  return (
    <AccountCenter
      adminLoadError={adminLoadErrors[0] ?? null}
      authorization={context.authorization}
      notice={profileUpdated ? "昵称已保存，侧栏身份信息已同步更新。" : null}
      permissions={permissionsResult?.ok ? permissionsResult.data : null}
      roles={rolesResult?.ok ? rolesResult.data : null}
      user={context.user}
    />
  );
}
