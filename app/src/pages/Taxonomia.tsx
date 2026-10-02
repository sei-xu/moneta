import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { BehaviorTag, CategoryCandidate } from "../lib/types";
import { Empty, ErrorBox, Panel } from "../components/common";

type Candidate =
  | { kind: "behavior_tag"; row: BehaviorTag }
  | { kind: "category"; row: CategoryCandidate };

function candidateKey(c: Candidate): string {
  return `${c.kind}:${c.row.id}`;
}

async function fetchCandidates(): Promise<Candidate[]> {
  const [tags, categories] = await Promise.all([
    supabase.from("behavior_tags").select("*").eq("status", "candidate").order("created_at"),
    supabase.from("categories").select("*").eq("status", "candidate").order("created_at"),
  ]);
  if (tags.error) throw new Error(tags.error.message);
  if (categories.error) throw new Error(categories.error.message);

  return [
    ...((tags.data ?? []) as BehaviorTag[]).map((row): Candidate => ({ kind: "behavior_tag", row })),
    ...((categories.data ?? []) as CategoryCandidate[]).map((row): Candidate => ({ kind: "category", row })),
  ];
}

export function Taxonomia() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCandidates()
      .then((rows) => {
        if (!cancelled) setCandidates(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic: the candidate disappears right away, and comes back if the
  // RPC turns out to have failed — there is no table policy to fall back on,
  // review_taxonomy_candidate is the only door (see migration 20260930000008).
  async function review(candidate: Candidate, action: "approved" | "rejected") {
    setActionError(null);
    setCandidates((prev) => (prev ?? []).filter((c) => candidateKey(c) !== candidateKey(candidate)));

    const { error: err } = await supabase.rpc("review_taxonomy_candidate", {
      p_kind: candidate.kind,
      p_id: candidate.row.id,
      p_action: action,
    });

    if (err) {
      setActionError(`Falha ao registrar a revisão: ${err.message}`);
      setCandidates((prev) => [...(prev ?? []), candidate]);
    }
  }

  if (error) return <ErrorBox message={`Não consegui carregar os candidatos: ${error}`} />;
  if (!candidates) return <Empty>Carregando…</Empty>;

  return (
    <>
      {actionError ? <ErrorBox message={actionError} /> : null}
      <Panel title="Candidatos de taxonomia">
        {candidates.length === 0
          ? (
            <Empty>
              Nenhum candidato pendente — lista vazia é o resultado normal na maior parte do
              tempo.
            </Empty>
          )
          : (
            <ul className="taxonomy-list">
              {candidates.map((c) => (
                <li key={candidateKey(c)} className="taxonomy-item">
                  <div>
                    <span className="status" style={{ marginRight: 8 }}>
                      {c.kind === "category" ? "📂 Categoria" : "🏷️ Tag de comportamento"}
                    </span>
                    <strong>{c.row.name}</strong>
                    {c.row.description ? <p>{c.row.description}</p> : null}
                    {c.kind === "behavior_tag" && c.row.trigger_pattern
                      ? (
                        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                          Padrão: {c.row.trigger_pattern}
                        </p>
                      )
                      : null}
                  </div>
                  <div>
                    <button className="action" onClick={() => review(c, "approved")}>
                      ✅ Aprovar
                    </button>
                    <button
                      className="action"
                      style={{ marginLeft: 8 }}
                      onClick={() => review(c, "rejected")}
                    >
                      ❌ Rejeitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Panel>
    </>
  );
}
