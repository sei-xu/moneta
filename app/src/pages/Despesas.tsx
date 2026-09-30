import { Fragment, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { buildExpensesQuery, PAGE_SIZE } from "../lib/queries";
import type { ExpenseFilters } from "../lib/queries";
import { date, money, monthKey, monthLabel } from "../lib/format";
import type { Category, Expense, ExpenseItem, PaymentMethod } from "../lib/types";
import { Empty, ErrorBox } from "../components/common";

function recentMonths(count = 18): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return out;
}

export function Despesas() {
  const [filters, setFilters] = useState<ExpenseFilters>({
    month: "all",
    categoryId: "all",
    paymentMethodId: "all",
  });
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);

  useEffect(() => {
    (async () => {
      const [cats, pms] = await Promise.all([
        supabase.from("categories").select("id, name, slug, icon, parent_id").order("name"),
        supabase.from("payment_methods").select("id, name, type").order("name"),
      ]);
      setCategories((cats.data ?? []) as Category[]);
      setMethods((pms.data ?? []) as PaymentMethod[]);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err, count } = await buildExpensesQuery(filters, page);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      setError(null);
      setRows((data ?? []) as Expense[]);
      setTotal(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  async function toggle(expenseId: string) {
    if (openId === expenseId) {
      setOpenId(null);
      return;
    }
    setOpenId(expenseId);
    const { data } = await supabase
      .from("expense_items")
      .select("*")
      .eq("expense_id", expenseId);
    setItems((data ?? []) as ExpenseItem[]);
  }

  function update(patch: Partial<ExpenseFilters>) {
    setPage(0);
    setFilters((f) => ({ ...f, ...patch }));
  }

  const categoryName = (id: string | null) =>
    id ? categories.find((c) => c.id === id)?.name ?? "—" : "Sem categoria";
  const methodName = (id: string | null) =>
    id ? methods.find((m) => m.id === id)?.name ?? "—" : "—";

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <>
      <div className="filters">
        <label>
          Mês
          <select
            value={filters.month}
            onChange={(e) => update({ month: e.target.value })}
          >
            <option value="all">Todos</option>
            {recentMonths().map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select
            value={filters.categoryId}
            onChange={(e) => update({ categoryId: e.target.value })}
          >
            <option value="all">Todas</option>
            <option value="none">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          Pagamento
          <select
            value={filters.paymentMethodId}
            onChange={(e) => update({ paymentMethodId: e.target.value })}
          >
            <option value="all">Todos</option>
            <option value="none">Não informado</option>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? <ErrorBox message={`Não consegui carregar as despesas: ${error}`} /> : null}
      {!error && rows === null ? <Empty>Carregando…</Empty> : null}
      {!error && rows?.length === 0 ? <Empty>Nenhuma despesa com esses filtros.</Empty> : null}

      {rows && rows.length > 0
        ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Estabelecimento</th>
                  <th>Categoria</th>
                  <th>Pagamento</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="clickable" onClick={() => toggle(e.id)}>
                      <td>{date(e.transaction_time)}</td>
                      <td>{e.merchant ?? "—"}</td>
                      <td>{categoryName(e.category_id)}</td>
                      <td>{methodName(e.payment_method_id)}</td>
                      <td className="num">{money(e.amount)}</td>
                    </tr>
                    {openId === e.id
                      ? (
                        <tr>
                          <td colSpan={5}>
                            {items.length === 0
                              ? <em>Sem itens discriminados.</em>
                              : (
                                <ul>
                                  {items.map((i) => (
                                    <li key={i.id}>
                                      {i.description}
                                      {i.total != null ? ` — ${money(i.total)}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            {e.notes ? <p>{e.notes}</p> : null}
                          </td>
                        </tr>
                      )
                      : null}
                  </Fragment>
                ))}
              </tbody>
            </table>

            <div className="filters" style={{ marginTop: 14 }}>
              <button
                className="action"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ← Anteriores
              </button>
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {total} despesa{total === 1 ? "" : "s"} · página {page + 1} de {lastPage + 1}
              </span>
              <button
                className="action"
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage}
              >
                Próximas →
              </button>
            </div>
          </>
        )
        : null}
    </>
  );
}
