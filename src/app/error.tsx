"use client";

/**
 * 全局错误边界。
 *
 * 2026-10-01 的重要修改：**不再把任何异常都断言成「数据库未启动」**。
 *
 * 在此之前是固定文案「请确认数据库已经启动，然后重试。」，而实际最常命中的
 * 原因是**会话过期**——Access Token 只有 15 分钟，用户开着页面想很久再点保存
 * 就会撞上。把「你重登一下」说成「你的数据库可能挂了」，
 * 会让用户怀疑数据还在不在，**损伤的是信任，不只是体验**。
 *
 * 现在按可识别的线索给三类提示，且**都不做没有依据的病因断言**：
 *   1. 会话/认证类      → 明确提示重新登录
 *   2. 网络/传输类      → 提示连接问题，可重试
 *   3. 其它            → 中性的「出了点问题」，附错误编号便于对照日志
 *
 * digest 由 Next 生成，服务端日志里也有同一编号 —— 显示出来是为了让用户
 * 能把它贴给维护者，而不是让用户去猜。
 */

const AUTH_HINTS = [
  "unauthorized",
  "401",
  "session",
  "auth",
  "登录",
  "会话",
  "unexpected response was received from the server",
];

const NETWORK_HINTS = [
  "failed to fetch",
  "networkerror",
  "network error",
  "load failed",
  "ecconnrefused",
  "etimedout",
  "fetch failed",
];

function classify(message: string): "auth" | "network" | "unknown" {
  const normalized = message.toLowerCase();
  if (AUTH_HINTS.some((hint) => normalized.includes(hint))) return "auth";
  if (NETWORK_HINTS.some((hint) => normalized.includes(hint))) return "network";
  return "unknown";
}

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const kind = classify(error.message ?? "");

  const copy = {
    auth: {
      title: "登录已过期",
      body: "你的登录会话失效了，重新登录后可以继续。刚才的输入不会因此丢失。",
      action: "重新登录",
    },
    network: {
      title: "连接出了点问题",
      body: "没能和服务器通信，可能是一时的网络波动。稍等一下再试通常就好了。",
      action: "重试",
    },
    unknown: {
      title: "出了点问题",
      body: "这次操作没有完成。可以先重试；如果反复出现，把下面的错误编号发给维护者。",
      action: "重试",
    },
  }[kind];

  return (
    <div className="center-state">
      <p className="eyebrow">Something went wrong</p>
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      {kind === "auth" ? (
        // 用整页跳转而不是 router 跳转：此时客户端状态可能已经不一致，
        // 重新走一次完整请求最可靠。
        <a className="button button-primary" href="/login">重新登录</a>
      ) : (
        <button className="button button-primary" onClick={reset} type="button">
          {copy.action}
        </button>
      )}
      {error.digest ? (
        <p className="error-digest">错误编号：{error.digest}</p>
      ) : null}
    </div>
  );
}
