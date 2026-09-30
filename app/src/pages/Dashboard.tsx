import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { money, monthKey, monthLabel, toNumber } from "../lib/format";
import type { CategorySummaryRow, PaymentUsageRow } from "../lib/types";
import { CategoryBars } from "../components/CategoryBars";
import { Empty, ErrorBox, Panel, Tile } from "../components/common";

export function Dashboard() {
  const [rows, setRows] = useState<CategorySummaryRow[] | null>(null);
  const [payments, setPayments] = useState<PaymentUsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthKey(new Date()));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [summary, usage] = await Promise.all([
        supabase.from("expense_summary_by_category").select("*"),
        supabase.from("payment_method_usage").select("*"),
      ]);
      if (cancelled) return;
      const failure = summary.error ?? usage.error;
      if (failure) {
        setError(failure.message);
        return;
      }
      setRows((summary.data ?? []) as CategorySummaryRow[]);
      setPayments((usage.data ?? []) as PaymentUsageRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const months = useMemo(() => {
    if (!rows) return [];
    const keys = new Set<string>();
    for (const row of rows) {
      if (row.month) keys.add(row.month.slice(0, 7));
    }
    return [...keys].sort().reverse();
  }, [rows]);

  const forMonth = useMemo(
    () => (rows ?? []).filter((r) => r.month?.slice(0, 7) === month),
    [rows, month],
  );

  const total = forMonth.reduce((sum, r) => sum + toNumber(r.total_amount), 0);
  const count = forMonth.reduce((sum, r) => sum + (r.expense_count ?? 0), 0);

  if (error) return <ErrorBox message={`Não consegui carregar o resumo: ${error}`} />;
  if (!rows || !payments) return <Empty>Carregando…</Empty>;
  if (rows.length === 0) {
    return <Empty>Nenhuma despesa registrada ainda.</Empty>;
  }

  const bars = forMonth.map((r) => ({
    label: r.category_name ?? "Sem categoria",
    value: toNumber(r.total_amount),
  }));

  return (
    <>
      <div className="filters">
        <label>
          Mês
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
            {months.includes(month) ? null : (
              <option value={month}>{monthLabel(month)}</option>
            )}
          </select>
        </label>
      </div>

      <div className="tiles">
        <Tile label="Total no mês" value={money(total)} />
        <Tile label="Despesas" value={count} />
        <Tile
          label="Ticket médio"
          value={count > 0 ? money(total / count) : "—"}
        />
        <Tile label="Categorias" value={forMonth.length} />
      </div>

      <Panel title={`Gasto por categoria — ${monthLabel(month)}`}>
        {bars.length === 0
          ? <Empty>Nenhuma despesa neste mês.</Empty>
          : <CategoryBars data={bars} />}
      </Panel>

      <Panel title="Formas de pagamento (todo o histórico)">
        {payments.length === 0 ? <Empty>Nada registrado.</Empty> : (
          <table>
            <thead>
              <tr>
                <th>Forma</th>
                <th className="num">Usos</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id ?? p.payment_method ?? "none"}>
                  <td>{p.payment_method ?? "Não informado"}</td>
                  <td className="num">{p.usage_count}</td>
                  <td className="num">{money(p.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
