import { BlockList, isIP } from "node:net";

export class SourceInspectionError extends Error {
  readonly code: string;
  readonly details: {
    finalUrl?: string;
    httpStatus?: number;
    contentType?: string;
    responseBytes?: number;
  };

  constructor(
    code: string,
    message: string,
    details: SourceInspectionError["details"] = {},
  ) {
    super(message);
    this.name = "SourceInspectionError";
    this.code = code;
    this.details = details;
  }
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

export function isPublicNetworkAddress(input: string): boolean {
  const address = input.toLowerCase().split("%")[0] ?? "";
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family !== 6 || address.startsWith("::ffff:")) return false;

  const firstHextet = Number.parseInt(address.split(":")[0] || "0", 16);
  const isGlobalUnicast = firstHextet >= 0x2000 && firstHextet <= 0x3fff;
  return isGlobalUnicast && !blockedIpv6.check(address, "ipv6");
}

export function parseInspectableSourceUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_URL_INVALID",
      "来源 URL 无效。",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_PROTOCOL_BLOCKED",
      "来源检查仅支持 HTTP(S)。",
    );
  }
  if (url.username || url.password) {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_CREDENTIALS_BLOCKED",
      "来源 URL 不能包含用户名或密码。",
    );
  }
  const allowedPort =
    !url.port ||
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443");
  if (!allowedPort) {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_PORT_BLOCKED",
      "来源检查只允许标准 HTTP/HTTPS 端口。",
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_PRIVATE_ADDRESS",
      "来源地址指向本机或内部网络，已阻止检查。",
    );
  }
  if (isIP(hostname) && !isPublicNetworkAddress(hostname)) {
    throw new SourceInspectionError(
      "EVIDENCE_SOURCE_PRIVATE_ADDRESS",
      "来源地址不是公共网络地址，已阻止检查。",
    );
  }
  return url;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (entity, token: string) => {
      if (token.startsWith("#x") || token.startsWith("#X")) {
        const codePoint = Number.parseInt(token.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      if (token.startsWith("#")) {
        const codePoint = Number.parseInt(token.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      return namedEntities[token.toLowerCase()] ?? entity;
    },
  );
}

export function normalizeInspectableText(value: string): string {
  return decodeHtmlEntities(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractInspectableContent(
  source: string,
  mimeType: string,
): { title: string | null; text: string } {
  if (mimeType === "text/plain") {
    return { title: null, text: normalizeInspectableText(source) };
  }

  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const withoutNonContent = source
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  const text = withoutNonContent.replace(/<[^>]+>/g, " ");
  return {
    title: titleMatch
      ? normalizeInspectableText(titleMatch[1]).slice(0, 300) || null
      : null,
    text: normalizeInspectableText(text),
  };
}

export function sourceContainsExcerpt(sourceText: string, excerpt: string): boolean {
  const normalizedExcerpt = normalizeInspectableText(excerpt);
  return normalizedExcerpt.length > 0 && sourceText.includes(normalizedExcerpt);
}
