export function normalizeSubjectPath(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the literal value so a stray percent sign remains searchable.
  }
  return decoded.normalize("NFKC").trim().slice(0, 200);
}
