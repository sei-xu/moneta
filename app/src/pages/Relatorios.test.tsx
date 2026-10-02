import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Report } from "../lib/types";

let queryResult: { data: Report[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};

function makeBuilder() {
  const builder: PromiseLike<typeof queryResult> & Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled: (v: typeof queryResult) => unknown) =>
      Promise.resolve(queryResult).then(onFulfilled),
  } as never;
  return builder;
}

vi.mock("../lib/supabase", () => ({
  supabase: { from: () => makeBuilder() },
}));

const { Relatorios } = await import("./Relatorios");

function baseReport(overrides: Partial<Report> = {}): Report {
  return {
    id: "r1",
    period_start: "2026-09-21",
    period_end: "2026-09-27",
    report_type: "weekly",
    headline: "Semana dentro da média",
    changes: [],
    consistencies: [],
    taxonomy_notes: [],
    forward_looking: [],
    full_content: null,
    notification_decision: "report_ready",
    model_notes: null,
    model_used: null,
    created_at: "2026-09-28T00:00:00Z",
    ...overrides,
  };
}

describe("Relatorios", () => {
  beforeEach(() => {
    queryResult = { data: [], error: null };
  });

  it("renders a structured taxonomy note with its kind badge", async () => {
    queryResult = {
      data: [
        baseReport({
          taxonomy_notes: [
            {
              kind: "behavior_tag",
              name: "Compra por impulso",
              rationale: "Picos fora do padrão.",
            },
          ],
        }),
      ],
      error: null,
    };
    render(<Relatorios />);
    await screen.findByText("Compra por impulso");
    expect(screen.getByText(/Picos fora do padrão/)).toBeInTheDocument();
  });

  it("renders a legacy string taxonomy note without crashing", async () => {
    queryResult = {
      data: [baseReport({ taxonomy_notes: ["Assinaturas de streaming"] })],
      error: null,
    };
    render(<Relatorios />);
    await screen.findByText("Assinaturas de streaming");
  });
});
