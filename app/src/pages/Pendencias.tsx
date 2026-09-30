import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { toNumber } from "../lib/format";
import type { ProcessingMetrics, QueueStatusRow } from "../lib/types";
import { Empty, ErrorBox, Panel, StatusBadge, Tile } from "../components/common";

export function Pendencias() {
  const [queue, setQueue] = useState<QueueStatusRow[] | null>(null);
  const [metrics, setMetrics] = useState<ProcessingMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [q, m] = await Promise.all([
        supabase.from("pending_expenses_status_summary").select("*"),
        supabase.from("processing_performance_metrics").select("*").maybeSingle(),
      ]);
      if (cancelled) return;
      const failure = q.error ?? m.error;
      if (failure) {
        setError(failure.message);
        return;
      }
      setQueue((q.data ?? []) as QueueStatusRow[]);
      setMetrics((m.data ?? null) as ProcessingMetrics | null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorBox message={`Não consegui carregar a fila: ${error}`} />;
  if (!queue) return <Empty>Carregando…</Empty>;

  const successRate = metrics?.success_rate_percent;

  return (
    <>
      {metrics
        ? (
          <div className="tiles">
            <Tile
              label="Taxa de sucesso"
              value={successRate == null ? "—" : `${toNumber(successRate).toFixed(0)}%`}
              sub="últimos 30 dias"
            />
            <Tile label="Processados" value={metrics.total_processed} sub="últimos 30 dias" />
            <Tile label="Esperando você" value={metrics.awaiting_user} />
            <Tile label="Com erro" value={metrics.error_count} />
          </div>
        )
        : null}

      <Panel title="Situação da fila">
        {queue.length === 0 ? <Empty>Fila vazia — tudo processado.</Empty> : (
          <table>
            <thead>
              <tr>
                <th>Situação</th>
                <th className="num">Itens</th>
                <th className="num">Mais antigo (h)</th>
                <th className="num">Tentativas (média)</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <tr key={row.status}>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="num">{row.count}</td>
                  <td className="num">
                    {row.oldest_age_hours == null ? "—" : Math.round(row.oldest_age_hours)}
                  </td>
                  <td className="num">
                    {row.avg_attempts == null ? "—" : toNumber(row.avg_attempts).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {metrics && metrics.needs_detail_count > 0
        ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
            {metrics.needs_detail_count} recibo(s) ficaram ilegíveis para a IA e
            precisam de informação sua — responda pelo bot com <code>/revisar</code>.
          </p>
        )
        : null}
    </>
  );
}
