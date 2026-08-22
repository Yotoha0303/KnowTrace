export const SEARCH_QUERY_MAX_LENGTH = 100;

export function normalizeSearchQuery(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, SEARCH_QUERY_MAX_LENGTH);
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
