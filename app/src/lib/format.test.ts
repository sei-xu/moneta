import { describe, expect, it } from "vitest";
import {
  date,
  money,
  monthEnd,
  monthKey,
  monthLabel,
  monthStart,
  toNumber,
  truncate,
} from "./format";

describe("toNumber", () => {
  it("accepts the strings PostgREST returns for numeric columns", () => {
    // numeric never arrives as a JS number — treating it as one silently
    // produces NaN totals across the dashboard
    expect(toNumber("42.50")).toBe(42.5);
  });

  it("falls back to zero rather than NaN", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(Number.NaN)).toBe(0);
  });
});

describe("money", () => {
  it("formats as BRL", () => {
    // non-breaking space between symbol and digits, hence the normalisation
    expect(money(1234.5).replace(/ /g, " ")).toBe("R$ 1.234,50");
  });

  it("formats a numeric string the same as the number", () => {
    expect(money("1234.5")).toBe(money(1234.5));
  });
});

describe("date", () => {
  it("renders a timestamptz in pt-BR", () => {
    expect(date("2026-09-21T15:00:00Z")).toBe("21/09/2026");
  });

  it("shows a dash for missing or unparseable values", () => {
    expect(date(null)).toBe("—");
    expect(date("not a date")).toBe("—");
  });
});

describe("month helpers", () => {
  it("derives a UTC month key", () => {
    expect(monthKey(new Date("2026-09-30T23:30:00Z"))).toBe("2026-09");
  });

  it("builds a half-open range", () => {
    expect(monthStart("2026-09")).toBe("2026-09-01T00:00:00.000Z");
    expect(monthEnd("2026-09")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls the year over at December", () => {
    expect(monthEnd("2026-12")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("labels a month readably", () => {
    expect(monthLabel("2026-09")).toContain("setembro");
  });
});

describe("truncate", () => {
  it("leaves short labels alone", () => {
    expect(truncate("Mercado", 20)).toBe("Mercado");
  });

  it("ellipsises long ones to the limit", () => {
    const out = truncate("Supermercado Municipal Central", 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});
