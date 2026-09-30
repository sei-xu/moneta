import { supabase } from "./supabase";
import { monthEnd, monthStart } from "./format";

export interface ExpenseFilters {
  month: string | "all";
  categoryId: string | "all";
  paymentMethodId: string | "all";
}

export const PAGE_SIZE = 25;

/**
 * Builds the expenses query. Kept separate from the component so the filter
 * translation can be tested without a network or a DOM.
 */
export function buildExpensesQuery(filters: ExpenseFilters, page: number) {
  let query = supabase
    .from("expenses")
    .select("*", { count: "exact" })
    .order("transaction_time", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (filters.month !== "all") {
    query = query
      .gte("transaction_time", monthStart(filters.month))
      .lt("transaction_time", monthEnd(filters.month));
  }
  if (filters.categoryId !== "all") {
    query = filters.categoryId === "none"
      ? query.is("category_id", null)
      : query.eq("category_id", filters.categoryId);
  }
  if (filters.paymentMethodId !== "all") {
    query = filters.paymentMethodId === "none"
      ? query.is("payment_method_id", null)
      : query.eq("payment_method_id", filters.paymentMethodId);
  }

  return query;
}
