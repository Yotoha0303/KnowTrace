import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import {
  extractInspectableContent,
  isPublicNetworkAddress,
  parseInspectableSourceUrl,
  sourceContainsExcerpt,
  SourceInspectionError,
} from "./source-policy";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const INSPECTABLE_MIME_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "text/plain",
]);

type PinnedAddress = { address: string; family: 4 | 6 };

type SourceResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

type InspectorDependencies = {
  resolveAddress: (url: URL) => Promise<PinnedAddress>;
  request: (
    url: URL,
    address: PinnedAddress,
    options: { maxBytes: number; signal: AbortSignal },
  ) => Promise<SourceResponse>;
};

export type EvidenceSourceInspection =
  | {
      status: "passed";
      requestedUrl: string;
      finalUrl: string;
      httpStatus: number;
      contentType: string;
      contentHash: string;
      fetchedTitle: string | null;
      excerptMatch: boolean;
      responseBytes: number;
      errorCode: null;
    }
  | {
      status: "failed";
      requestedUrl: string;
      finalUrl: string | null;
      httpStatus: number | null;
      contentType: string | null;
      contentHash: null;
      fetchedTitle: null;
      excerptMatch: null;
      responseBytes: number | null;
      errorCode: string;
    };

function contentTypeDetails(header: string | undefined): {
  mimeType: string;
  charset: string;
} {
  const [rawMimeType = "", ...parameters] = (header ?? "").split(";");
  const charsetParameter = parameters.find((value) =>
    value.trim().toLowerCase().startsWith("charset="),
  );
  return {
    mimeType: rawMimeType.trim().toLowerCase(),
    charset:
      charsetParameter?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "") ||
      "utf-8",
  };
}

async function resolvePublicAddress(url: URL): Promise<PinnedAddress> {
  const hostname = url.hostname;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return { address: hostname, family: 4 };
  }
  if (hostname.includes(":")) return { address: hostname, family: 6 };

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, order: "ipv4first" });
  } catch {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_DNS_FAILED",
      "无法解析来源域名。",
      { finalUrl: url.toString() },
    );
  }
  if (!addresses.length) {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_DNS_FAILED",
      "来源域名没有可用地址。",
      { finalUrl: url.toString() },
    );
  }
  if (addresses.some((item) => !isPublicNetworkAddress(item.address))) {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_PRIVATE_ADDRESS",
      "来源域名解析到内部或保留网络地址，已阻止检查。",
      { finalUrl: url.toString() },
    );
  }
  const selected = addresses[0];
  return {
    address: selected.address,
    family: selected.family as 4 | 6,
  };
}

function requestPinnedSource(
  url: URL,
  address: PinnedAddress,
  options: { maxBytes: number; signal: AbortSignal },
): Promise<SourceResponse> {
  return new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [address]);
        return;
      }
      callback(null, address.address, address.family);
    };
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "accept-encoding": "identity",
          "user-agent": "KnowTrace-Evidence-Checker/0.1",
        },
        lookup: pinnedLookup,
        maxHeaderSize: 16_384,
        signal: options.signal,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
          response.destroy();
          reject(
            new SourceInspectionError(
              "EVIDENCE_SOURCE_TOO_LARGE",
              "来源内容超过检查大小限制。",
              {
                finalUrl: url.toString(),
                httpStatus: statusCode,
                contentType: response.headers["content-type"],
                responseBytes: declaredLength,
              },
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let responseBytes = 0;
        response.on("data", (chunk: Buffer) => {
          responseBytes += chunk.length;
          if (responseBytes > options.maxBytes) {
            response.destroy(
              new SourceInspectionError(
                "EVIDENCE_SOURCE_TOO_LARGE",
                "来源内容超过检查大小限制。",
                {
                  finalUrl: url.toString(),
                  httpStatus: statusCode,
                  contentType: response.headers["content-type"],
                  responseBytes,
                },
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const defaultDependencies: InspectorDependencies = {
  resolveAddress: resolvePublicAddress,
  request: requestPinnedSource,
};

export async function inspectEvidenceSource(
  input: {
    sourceUrl: string;
    excerpt: string;
    timeoutMs?: number;
    maxBytes?: number;
  },
  dependencies: InspectorDependencies = defaultDependencies,
): Promise<EvidenceSourceInspection> {
  const requestedUrl = input.sourceUrl;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let currentUrl = parseInspectableSourceUrl(requestedUrl);
    let response: SourceResponse | null = null;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const address = await dependencies.resolveAddress(currentUrl);
      response = await dependencies.request(currentUrl, address, { maxBytes, signal });
      const location = response.headers.location;
      const isRedirect = response.statusCode >= 300 && response.statusCode < 400;
      if (!isRedirect) break;
      if (!location) {
        throw new SourceInspectionError(
          "EVIDENCE_SOURCE_REDIRECT_INVALID",
          "来源返回了无目标的重定向。",
          { finalUrl: currentUrl.toString(), httpStatus: response.statusCode },
        );
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new SourceInspectionError(
          "EVIDENCE_SOURCE_REDIRECT_LIMIT",
          "来源重定向次数过多。",
          { finalUrl: currentUrl.toString(), httpStatus: response.statusCode },
        );
      }
      currentUrl = parseInspectableSourceUrl(new URL(location, currentUrl).toString());
      response = null;
    }

    if (!response) {
      throw new SourceInspectionError(
        "EVIDENCE_SOURCE_UNAVAILABLE",
        "来源没有返回可检查内容。",
        { finalUrl: currentUrl.toString() },
      );
    }
    const contentTypeHeader = response.headers["content-type"];
    const { mimeType, charset } = contentTypeDetails(contentTypeHeader);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new SourceInspectionError(
        "EVIDENCE_SOURCE_HTTP_STATUS",
        "来源返回了非成功状态。",
        {
          finalUrl: currentUrl.toString(),
          httpStatus: response.statusCode,
          contentType: contentTypeHeader,
          responseBytes: response.body.length,
        },
      );
    }
    if (!INSPECTABLE_MIME_TYPES.has(mimeType)) {
      throw new SourceInspectionError(
        "EVIDENCE_SOURCE_CONTENT_TYPE_BLOCKED",
        "来源不是可检查的 HTML 或纯文本内容。",
        {
          finalUrl: currentUrl.toString(),
          httpStatus: response.statusCode,
          contentType: contentTypeHeader,
          responseBytes: response.body.length,
        },
      );
    }

    let decoded: string;
    try {
      decoded = new TextDecoder(charset).decode(response.body);
    } catch {
      throw new SourceInspectionError(
        "EVIDENCE_SOURCE_CHARSET_UNSUPPORTED",
        "来源字符编码暂不支持。",
        {
          finalUrl: currentUrl.toString(),
          httpStatus: response.statusCode,
          contentType: contentTypeHeader,
          responseBytes: response.body.length,
        },
      );
    }
    const content = extractInspectableContent(decoded, mimeType);
    return {
      status: "passed",
      requestedUrl,
      finalUrl: currentUrl.toString(),
      httpStatus: response.statusCode,
      contentType: mimeType,
      contentHash: createHash("sha256").update(response.body).digest("hex"),
      fetchedTitle: content.title,
      excerptMatch: sourceContainsExcerpt(content.text, input.excerpt),
      responseBytes: response.body.length,
      errorCode: null,
    };
  } catch (error) {
    const sourceError =
      error instanceof SourceInspectionError
        ? error
        : new SourceInspectionError(
            error instanceof Error && error.name === "AbortError"
              ? "EVIDENCE_SOURCE_TIMEOUT"
              : "EVIDENCE_SOURCE_UNAVAILABLE",
            "来源暂时无法检查。",
          );
    return {
      status: "failed",
      requestedUrl,
      finalUrl: sourceError.details.finalUrl ?? null,
      httpStatus: sourceError.details.httpStatus ?? null,
      contentType: sourceError.details.contentType ?? null,
      contentHash: null,
      fetchedTitle: null,
      excerptMatch: null,
      responseBytes: sourceError.details.responseBytes ?? null,
      errorCode: sourceError.code,
    };
  }
}
