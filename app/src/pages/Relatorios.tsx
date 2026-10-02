import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { date } from "../lib/format";
import type { Report, TaxonomyNote } from "../lib/types";
import { Empty, ErrorBox, Panel } from "../components/common";

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <h4 style={{ margin: "12px 0 2px", fontSize: 14 }}>{title}</h4>
      <ul>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </>
  );
}

// taxonomy_notes predates its structured form — older reports still have
// plain strings, so both shapes are rendered here rather than migrated.
function TaxonomySection({ items }: { items: (string | TaxonomyNote)[] }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <h4 style={{ margin: "12px 0 2px", fontSize: 14 }}>Notas de taxonomia</h4>
      <ul>
        {items.map((item, i) => {
          if (typeof item === "string") return <li key={i}>{item}</li>;
          const kindLabel = item.kind === "category" ? "Categoria" : "Tag de comportamento";
          return (
            <li key={i}>
              <strong>{item.name}</strong>{" "}
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>({kindLabel})</span>
              {item.rationale ? ` — ${item.rationale}` : ""}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Relatorios() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from("reports")
        .select("*")
        .order("period_start", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      const rows = (data ?? []) as Report[];
      setReports(rows);
      if (rows.length > 0) setOpenId(rows[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorBox message={`Não consegui carregar os relatórios: ${error}`} />;
  if (!reports) return <Empty>Carregando…</Empty>;
  if (reports.length === 0) {
    return (
      <Empty>
        Nenhum relatório ainda. A análise roda às segundas; para gerar agora,
        mande <code>/analisar</code> para o bot.
      </Empty>
    );
  }

  return (
    <>
      {reports.map((r) => {
        const open = openId === r.id;
        return (
          <Panel key={r.id} title={`${date(r.period_start)} – ${date(r.period_end)}`}>
            <div className="report">
              <h3>{r.headline ?? "Sem resumo"}</h3>
              <div className="period">
                {r.report_type === "followup" ? "Acompanhamento" : "Semanal"}
                {r.model_used ? ` · ${r.model_used}` : ""}
              </div>

              <button className="action" onClick={() => setOpenId(open ? null : r.id)}>
                {open ? "Recolher" : "Ver detalhes"}
              </button>

              {open
                ? (
                  <>
                    <Section title="O que mudou" items={r.changes} />
                    <Section title="O que se manteve" items={r.consistencies} />
                    <TaxonomySection items={r.taxonomy_notes} />
                    {r.forward_looking?.length > 0
                      ? (
                        <>
                          <h4 style={{ margin: "12px 0 2px", fontSize: 14 }}>
                            A acompanhar
                          </h4>
                          <ul>
                            {r.forward_looking.map((f, i) => (
                              <li key={i}>
                                <strong>{f.topic}</strong>
                                {f.question ? ` — ${f.question}` : ""}
                                {f.revisit_in_days
                                  ? ` (revisitar em ${f.revisit_in_days} dias)`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        </>
                      )
                      : null}
                    {r.full_content ? <pre>{r.full_content}</pre> : null}
                    {r.model_notes
                      ? (
                        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                          Limitações apontadas pelo modelo: {r.model_notes}
                        </p>
                      )
                      : null}
                  </>
                )
                : null}
            </div>
          </Panel>
        );
      })}
    </>
  );
}
