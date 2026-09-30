const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const compactBrl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

const monthFmt = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Amounts arrive from PostgREST as strings (numeric) or numbers. */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function money(value: unknown): string {
  return brl.format(toNumber(value));
}

/** For axis ticks, where full currency strings collide. */
export function moneyCompact(value: unknown): string {
  return compactBrl.format(toNumber(value));
}

export function date(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** A 'YYYY-MM' key rendered as a readable month. */
export function monthLabel(key: string): string {
  const d = new Date(`${key}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? key : monthFmt.format(d);
}

/** The 'YYYY-MM' key for a date, in UTC to match how periods are stored. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First instant of a month key, as an ISO string for range filters. */
export function monthStart(key: string): string {
  return `${key}-01T00:00:00.000Z`;
}

/** First instant of the month after `key` — the exclusive end of a range. */
export function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return monthStart(next);
}

/** Truncates a label so axis ticks and table cells stay on one line. */
export function truncate(text: string, max = 22): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
