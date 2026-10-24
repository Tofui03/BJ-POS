import { describe, expect, it } from "vitest";
import {
  assertCanCloseDay,
  businessDateFor,
  filterPushedRecordIds,
  localDateStr,
  nextDateStr,
} from "./closeday.js";
import { PosError } from "./errors.js";

describe("business-day rules", () => {
  it("formats local calendar dates", () => {
    expect(localDateStr(new Date(2026, 6, 13, 9, 30))).toBe("2026-07-13");
    expect(localDateStr(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("rolls to the next day, across month and year ends", () => {
    expect(nextDateStr("2026-07-13")).toBe("2026-07-14");
    expect(nextDateStr("2026-07-31")).toBe("2026-08-01");
    expect(nextDateStr("2026-12-31")).toBe("2027-01-01");
    expect(nextDateStr("2028-02-28")).toBe("2028-02-29"); // leap year
  });

  it("stamps sales to today while the day is open", () => {
    const now = new Date(2026, 6, 13, 15, 0);
    expect(businessDateFor(now, false)).toBe("2026-07-13");
  });

  it("pushes sales after Close Day to tomorrow", () => {
    const now = new Date(2026, 6, 13, 16, 30);
    expect(businessDateFor(now, true)).toBe("2026-07-14");
  });
});

describe("assertCanCloseDay", () => {
  it("allows closing today if not already closed", () => {
    expect(() => assertCanCloseDay("2026-07-13", "2026-07-13", false)).not.toThrow();
  });

  it("allows closing past unclosed day", () => {
    expect(() => assertCanCloseDay("2026-07-12", "2026-07-13", false)).not.toThrow();
  });

  it("rejects future date before it arrives", () => {
    expect(() => assertCanCloseDay("2026-07-14", "2026-07-13", false)).toThrow(PosError);
    expect(() => assertCanCloseDay("2026-07-14", "2026-07-13", false)).toThrow(
      "cannot close 2026-07-14 before that day arrives",
    );
  });

  it("rejects day that is already closed", () => {
    expect(() => assertCanCloseDay("2026-07-13", "2026-07-13", true)).toThrow(PosError);
    expect(() => assertCanCloseDay("2026-07-13", "2026-07-13", true)).toThrow(
      "day 2026-07-13 is already closed",
    );
  });
});

describe("filterPushedRecordIds", () => {
  it("filters records created on reopened calendar date", () => {
    const ts1 = new Date("2026-07-13T23:30:00").getTime();
    const ts2 = new Date("2026-07-14T01:00:00").getTime();
    const ts3 = new Date("2026-07-13T23:45:00").getTime();

    const records = [
      { id: 101, ts: ts1 },
      { id: 102, ts: ts2 },
      { id: 103, ts: ts3 },
    ];

    expect(filterPushedRecordIds(records, "2026-07-13")).toEqual([101, 103]);
    expect(filterPushedRecordIds(records, "2026-07-14")).toEqual([102]);
    expect(filterPushedRecordIds(records, "2026-07-15")).toEqual([]);
  });
});
