import { beforeEach, describe, expect, it, vi } from "vitest";

// Records the PostgREST builder chain instead of issuing a request, so the
// filter translation can be asserted without a network or a live project.
const calls: { method: string; args: unknown[] }[] = [];

const builder: Record<string, unknown> = {};
for (const method of ["select", "order", "range", "gte", "lt", "eq", "is"]) {
  builder[method] = (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };
}

vi.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
  },
}));

const { buildExpensesQuery, PAGE_SIZE } = await import("./queries");

function argsFor(method: string) {
  return calls.filter((c) => c.method === method).map((c) => c.args);
}

describe("buildExpensesQuery", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("queries expenses newest first, paginated", () => {
    buildExpensesQuery(
      { month: "all", categoryId: "all", paymentMethodId: "all" },
      0,
    );
    expect(argsFor("from")[0]).toEqual(["expenses"]);
    expect(argsFor("order")[0]).toEqual([
      "transaction_time",
      { ascending: false },
    ]);
    expect(argsFor("range")[0]).toEqual([0, PAGE_SIZE - 1]);
  });

  it("offsets the range by page", () => {
    buildExpensesQuery(
      { month: "all", categoryId: "all", paymentMethodId: "all" },
      2,
    );
    expect(argsFor("range")[0]).toEqual([2 * PAGE_SIZE, 3 * PAGE_SIZE - 1]);
  });

  it("applies no date bounds when the month filter is off", () => {
    buildExpensesQuery(
      { month: "all", categoryId: "all", paymentMethodId: "all" },
      0,
    );
    expect(argsFor("gte")).toHaveLength(0);
    expect(argsFor("lt")).toHaveLength(0);
  });

  it("turns a month into a half-open range", () => {
    buildExpensesQuery(
      { month: "2026-09", categoryId: "all", paymentMethodId: "all" },
      0,
    );
    // half-open, so an expense at 2026-10-01T00:00:00Z belongs to October
    expect(argsFor("gte")[0]).toEqual([
      "transaction_time",
      "2026-09-01T00:00:00.000Z",
    ]);
    expect(argsFor("lt")[0]).toEqual([
      "transaction_time",
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("filters by category id", () => {
    buildExpensesQuery(
      { month: "all", categoryId: "cat-1", paymentMethodId: "all" },
      0,
    );
    expect(argsFor("eq")[0]).toEqual(["category_id", "cat-1"]);
  });

  it("uses IS NULL for the uncategorised filter, not eq", () => {
    buildExpensesQuery(
      { month: "all", categoryId: "none", paymentMethodId: "all" },
      0,
    );
    expect(argsFor("is")[0]).toEqual(["category_id", null]);
    expect(argsFor("eq")).toHaveLength(0);
  });

  it("uses IS NULL for an unset payment method", () => {
    buildExpensesQuery(
      { month: "all", categoryId: "all", paymentMethodId: "none" },
      0,
    );
    expect(argsFor("is")[0]).toEqual(["payment_method_id", null]);
  });

  it("combines every filter at once", () => {
    buildExpensesQuery(
      { month: "2026-09", categoryId: "cat-1", paymentMethodId: "pm-1" },
      0,
    );
    expect(argsFor("gte")).toHaveLength(1);
    expect(argsFor("lt")).toHaveLength(1);
    expect(argsFor("eq")).toEqual([
      ["category_id", "cat-1"],
      ["payment_method_id", "pm-1"],
    ]);
  });
});
