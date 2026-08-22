export const KNOWTRACE_TIME_ZONE = "Asia/Shanghai";

const dateTimeLocalFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: KNOWTRACE_TIME_ZONE,
});

export function toDateTimeLocalValue(date: Date): string {
  const parts = dateTimeLocalFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function dateTimeLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || toDateTimeLocalValue(parsed) !== value) return null;
  return parsed.toISOString();
}
