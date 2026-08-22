export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_SUBJECT_MAX_LENGTH = 200;

export function normalizeSearchQuery(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, SEARCH_QUERY_MAX_LENGTH);
}

export function normalizeSubjectFilter(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/gu, " ").slice(0, SEARCH_SUBJECT_MAX_LENGTH);
}

export function normalizeDateFilter(value: string | undefined): string {
  const candidate = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? candidate
    : "";
}

export function occurredAtBounds(from: string, to: string) {
  const start = from ? new Date(`${from}T00:00:00+08:00`) : null;
  const endStart = to ? new Date(`${to}T00:00:00+08:00`) : null;
  const endExclusive = endStart
    ? new Date(endStart.getTime() + 24 * 60 * 60 * 1_000)
    : null;
  return { start, endExclusive };
}

export function buildSearchPattern(query: string): string {
  const escaped = query.replace(/[\\%_]/gu, (character) => `\\${character}`);
  return `%${escaped}%`;
}

export function makeSearchSnippet(
  values: Array<string | null | undefined>,
  query: string,
  maxLength = 180,
): string {
  const text = values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" · ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text || maxLength <= 0) return "";
  if (text.length <= maxLength) return text;

  const normalizedQuery = normalizeSearchQuery(query).toLocaleLowerCase();
  const matchIndex = normalizedQuery
    ? text.toLocaleLowerCase().indexOf(normalizedQuery)
    : -1;
  const context = Math.max(Math.floor((maxLength - normalizedQuery.length) / 2), 0);
  const start = matchIndex > context ? matchIndex - context : 0;
  const end = Math.min(start + maxLength, text.length);

  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
