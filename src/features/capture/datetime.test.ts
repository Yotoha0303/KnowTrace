import { describe, expect, it } from "vitest";

import { dateTimeLocalToIso, toDateTimeLocalValue } from "./datetime";

describe("capture occurrence time conversion", () => {
  it("formats a Date for a datetime-local input without losing local wall time", () => {
    const instant = new Date("2026-08-22T01:05:00.000Z");
    expect(toDateTimeLocalValue(instant)).toBe("2026-08-22T09:05");
  });

  it("converts browser-local time into an ISO instant", () => {
    const iso = dateTimeLocalToIso("2026-08-22T09:05");
    expect(iso).not.toBeNull();
    expect(iso).toBe("2026-08-22T01:05:00.000Z");
  });

  it("rejects an empty or invalid value", () => {
    expect(dateTimeLocalToIso("")).toBeNull();
    expect(dateTimeLocalToIso("not-a-time")).toBeNull();
    expect(dateTimeLocalToIso("2026-02-31T09:05")).toBeNull();
  });
});
