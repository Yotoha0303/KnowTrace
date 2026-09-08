import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerMetricsRuntime } = await import("@/server/metrics");
    registerMetricsRuntime();
  }
}

function requestErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      digest:
        "digest" in error && typeof error.digest === "string"
          ? error.digest
          : undefined,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    digest: undefined,
  };
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordRequestError } = await import("@/server/metrics");
    recordRequestError(context.routeType, context.routePath);
  }

  console.error(
    "[knowtrace-request-error]",
    JSON.stringify({
      ...requestErrorDetails(error),
      method: request.method,
      path: request.path,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
    }),
  );
};
