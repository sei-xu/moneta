import type { ReactNode } from "react";

export function Tile(
  { label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode },
) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function ErrorBox({ message }: { message: string }) {
  return <p className="error">⚠️ {message}</p>;
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  pending: { color: "var(--warning)", label: "Aguardando processamento" },
  waiting_user: { color: "var(--serious)", label: "Esperando você" },
  done: { color: "var(--good)", label: "Processado" },
  discarded: { color: "var(--text-muted)", label: "Descartado" },
  error: { color: "var(--critical)", label: "Erro" },
};

/** Status colour never carries the meaning alone — the label always ships with it. */
export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? {
    color: "var(--text-muted)",
    label: status,
  };
  return (
    <span className="status">
      <span className="dot" style={{ background: style.color }} aria-hidden="true" />
      {style.label}
    </span>
  );
}
