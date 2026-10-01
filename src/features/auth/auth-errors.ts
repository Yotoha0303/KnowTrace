export const AUTH_ERROR_CODES = {
  invalidCredentials: "AUTH_INVALID_CREDENTIALS",
  loginRateLimited: "AUTH_LOGIN_RATE_LIMITED",
  accountDisabled: "AUTH_ACCOUNT_DISABLED",
  accountNotFound: "AUTH_ACCOUNT_NOT_FOUND",
  serviceUnavailable: "AUTH_SERVICE_UNAVAILABLE",
  contractInvalid: "AUTH_CONTRACT_INVALID",
  sessionExpired: "AUTH_SESSION_EXPIRED",
  refreshRejected: "AUTH_REFRESH_REJECTED",
  required: "AUTH_REQUIRED",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/**
 * go-user-system 的业务错误码，见 services/go-user-system/internal/response/code.go。
 */
const UPSTREAM_CODE = {
  invalidParams: 1001,
  registerFailed: 2002,
  userNotFound: 2003,
  userDisabled: 2004,
  loginFailed: 2005,
  loginRateLimited: 2008,
  refreshTokenInvalid: 3011,
  refreshTokenExpired: 3012,
  refreshTokenRevoked: 3013,
  permissionDenied: 5003,
  internalError: 6001,
  requestTimeout: 6002,
} as const;

const REFRESH_REJECTED_CODES: number[] = [
  UPSTREAM_CODE.refreshTokenInvalid,
  UPSTREAM_CODE.refreshTokenExpired,
  UPSTREAM_CODE.refreshTokenRevoked,
];

/**
 * 把「上游业务码 + HTTP 状态」翻译成客户端可区分的语义错误码。
 *
 * 修复前这一步不存在：上游业务码被直接塞进 `error.code` 后又在客户端被忽略，
 * 于是限流（2008）、账号停用（2004）和真正的密码错误（2005）都表现为同一句
 * 「账号或密码错误」。见 docs/17-mobile-client-bugs-and-features.md 的 BUG-002。
 *
 * 客户端只依赖这里返回的语义码，不依赖上游数字码；上游换号不会破坏客户端分支。
 */
/** 把「还要等多少秒」说成人话。取整到分钟，避免给出虚假的精度。 */
function formatRetryAfter(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `请在 ${seconds} 秒后重试。`;
  const minutes = Math.ceil(seconds / 60);
  return `请在约 ${minutes} 分钟后重试。`;
}

export function classifyAuthError(
  upstreamCode: number | null,
  status: number,
  /**
   * 上游在限流时给出的剩余秒数（来自 `Retry-After`）。
   *
   * 为什么需要它：原先锁定文案只写「请稍后再试」——既**没说明这是锁定**
   * （读起来像「慢一点」），也**没告诉用户要等多久**，于是用户反复重试，
   * 而每次重试都在延长自己的锁。
   * 见 docs/changes/2026-10-01-登录锁定可辨别性.md。
   */
  retryAfterSeconds?: number | null,
): { code: AuthErrorCode; message: string } {
  if (status === 503) {
    return {
      code: AUTH_ERROR_CODES.serviceUnavailable,
      message: "登录服务暂时不可用，请稍后重试。",
    };
  }
  if (upstreamCode === null) {
    return {
      code: AUTH_ERROR_CODES.contractInvalid,
      message: "登录服务返回了无法识别的响应。",
    };
  }
  switch (upstreamCode) {
    case UPSTREAM_CODE.loginRateLimited:
      return {
        code: AUTH_ERROR_CODES.loginRateLimited,
        // 明确「这是锁定」而不是「慢一点」，并给出剩余时间。
        message: `因连续登录失败，登录已被临时锁定。${formatRetryAfter(retryAfterSeconds)}`.trim(),
      };
    case UPSTREAM_CODE.userDisabled:
      return {
        code: AUTH_ERROR_CODES.accountDisabled,
        message: "该账号已被停用，请联系管理员。",
      };
    case UPSTREAM_CODE.userNotFound:
      return {
        code: AUTH_ERROR_CODES.accountNotFound,
        message: "账号不存在，请确认用户名。",
      };
    case UPSTREAM_CODE.loginFailed:
      return {
        code: AUTH_ERROR_CODES.invalidCredentials,
        message: "账号或密码错误。",
      };
    case UPSTREAM_CODE.requestTimeout:
    case UPSTREAM_CODE.internalError:
      return {
        code: AUTH_ERROR_CODES.serviceUnavailable,
        message: "登录服务暂时不可用，请稍后重试。",
      };
    default:
      break;
  }
  if (REFRESH_REJECTED_CODES.includes(upstreamCode)) {
    return {
      code: AUTH_ERROR_CODES.refreshRejected,
      message: "登录会话已过期，请重新登录。",
    };
  }
  return {
    code: AUTH_ERROR_CODES.contractInvalid,
    message: "登录服务返回了无法识别的响应。",
  };
}
