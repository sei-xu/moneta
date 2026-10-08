import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BehaviorTag, CategoryCandidate } from "../lib/types";

let tagsResult: { data: BehaviorTag[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
let categoriesResult: { data: CategoryCandidate[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
const rpcCalls: { fn: string; args: unknown }[] = [];
let rpcError: { message: string } | null = null;

function makeBuilder(result: unknown) {
  const builder: PromiseLike<unknown> & Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled),
  } as never;
  return builder;
}

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table === "behavior_tags" ? tagsResult : categoriesResult),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: rpcError });
    },
  },
}));

const { Taxonomia } = await import("./Taxonomia");

describe("Taxonomia", () => {
  beforeEach(() => {
    tagsResult = { data: [], error: null };
    categoriesResult = { data: [], error: null };
    rpcCalls.length = 0;
    rpcError = null;
  });

  it("shows an empty state when there are no candidates", async () => {
    render(<Taxonomia />);
    await screen.findByText(/Nenhum candidato/);
  });

  it("renders a behavior_tag candidate with its rationale", async () => {
    tagsResult = {
      data: [{
        id: "t1",
        name: "Compra por impulso",
        slug: "compra-por-impulso",
        description: "Picos fora do padrão.",
        trigger_pattern: null,
        example_items: [],
        status: "candidate",
        source_report_id: "r1",
        created_at: "2026-09-28T00:00:00Z",
        reviewed_at: null,
      }],
      error: null,
    };
    render(<Taxonomia />);
    await screen.findByText("Compra por impulso");
    expect(screen.getByText("Picos fora do padrão.")).toBeInTheDocument();
  });

  it("approving a candidate calls the RPC with the right args and removes it from the list", async () => {
    tagsResult = {
      data: [{
        id: "t1",
        name: "Compra por impulso",
        slug: "compra-por-impulso",
        description: "desc",
        trigger_pattern: null,
        example_items: [],
        status: "candidate",
        source_report_id: "r1",
        created_at: "2026-09-28T00:00:00Z",
        reviewed_at: null,
      }],
      error: null,
    };
    render(<Taxonomia />);
    await screen.findByText("Compra por impulso");

    fireEvent.click(screen.getByRole("button", { name: /Aprovar/ }));

    await waitFor(() => {
      expect(rpcCalls).toEqual([
        { fn: "review_taxonomy_candidate", args: { p_kind: "behavior_tag", p_id: "t1", p_action: "approved" } },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByText("Compra por impulso")).not.toBeInTheDocument();
    });
  });

  it("reverts the row when the RPC fails", async () => {
    rpcError = { message: "boom" };
    tagsResult = {
      data: [{
        id: "t1",
        name: "Compra por impulso",
        slug: "compra-por-impulso",
        description: "desc",
        trigger_pattern: null,
        example_items: [],
        status: "candidate",
        source_report_id: "r1",
        created_at: "2026-09-28T00:00:00Z",
        reviewed_at: null,
      }],
      error: null,
    };
    render(<Taxonomia />);
    await screen.findByText("Compra por impulso");

    fireEvent.click(screen.getByRole("button", { name: /Rejeitar/ }));

    await waitFor(() => {
      expect(screen.getByText(/Falha ao registrar/)).toBeInTheDocument();
    });
    expect(screen.getByText("Compra por impulso")).toBeInTheDocument();
  });
});
