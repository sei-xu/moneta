// Pure logic behind the analysis worker: period arithmetic, prompt assembly,
// validation of the model's JSON, notification routing and follow-up
// extraction. Nothing here touches the network or the environment, so it can
// be exercised directly by `deno test`.

export type NotificationDecision = "silent" | "report_ready" | "observation";

export interface ForwardLookingItem {
  topic: string;
  question: string;
  /** Absent or <= 0 means "no follow-up needed", only worth mentioning. */
  revisit_in_days?: number | null;
}

export interface AnalysisResult {
  headline: string;
  changes: string[];
  consistencies: string[];
  taxonomy_notes: string[];
  forward_looking: ForwardLookingItem[];
  full_content: string;
  notification_decision: NotificationDecision;
  model_notes: string | null;
}

export interface Period {
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Monday through Sunday of the ISO week before the one containing `now`,
 * in UTC. getUTCDay() returns 0 for Sunday, so it is remapped to 7 to make
 * Monday the first day of the week.
 */
export function previousIsoWeek(now: Date): Period {
  const isoDay = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const thisMonday = midnight - (isoDay - 1) * DAY_MS;
  const start = new Date(thisMonday - 7 * DAY_MS);
  const end = new Date(thisMonday - DAY_MS);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

/** JSON schema the model must answer with, mirroring the `reports` columns. */
export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
    consistencies: { type: "array", items: { type: "string" } },
    taxonomy_notes: { type: "array", items: { type: "string" } },
    forward_looking: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          question: { type: "string" },
          revisit_in_days: { type: "integer" },
        },
        required: ["topic", "question"],
        additionalProperties: false,
      },
    },
    full_content: { type: "string" },
    notification_decision: {
      type: "string",
      enum: ["silent", "report_ready", "observation"],
    },
    model_notes: { type: "string" },
  },
  required: [
    "headline",
    "changes",
    "consistencies",
    "taxonomy_notes",
    "forward_looking",
    "full_content",
    "notification_decision",
  ],
  additionalProperties: false,
} as const;

const BASE_INSTRUCTIONS = `Você é a Monēta, uma analista financeira pessoal. Receberá dados JÁ AGREGADOS de um período de gastos — você não tem acesso ao banco e não deve pedir mais dados.

Escreva em português do Brasil, com valores em reais. Seja concreta: cite números e nomes que estão nos dados. Não invente nada que não esteja no contexto.

Preencha os campos assim:
- headline: uma frase que resuma o período.
- changes: o que mudou em relação à média das 4 semanas anteriores (aumentos, quedas, categorias novas).
- consistencies: padrões que se mantiveram — o que é estrutural e não ruído.
- taxonomy_notes: candidatos a novas tags de comportamento ou categorias, quando um agrupamento relevante não cabe nas categorias atuais. Lista vazia é a resposta normal.
- forward_looking: pontos que merecem ser revisitados. Use revisit_in_days para pedir um acompanhamento futuro; omita quando for só uma observação.
- full_content: o relatório completo em markdown.
- model_notes: limitações dos dados que afetaram a análise.
- notification_decision: 'silent' quando nada no período justifica interromper o usuário; 'report_ready' quando há um relatório que vale a leitura; 'observation' apenas quando algo é urgente o suficiente para não esperar.`;

export function buildPrompt(
  context: unknown,
  customPrompt?: string | null,
): string {
  const sections = [BASE_INSTRUCTIONS];
  if (customPrompt) {
    sections.push(
      `Esta é uma análise de acompanhamento pedida por um relatório anterior. Foque em:\n${customPrompt}`,
    );
  }
  sections.push(`Dados do período:\n${JSON.stringify(context, null, 2)}`);
  return sections.join("\n\n");
}

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} is not an array`);
  return value.map(String);
}

/**
 * Parses and validates the model's answer. A structured-output request still
 * fails occasionally (truncation, a wrapped code fence, an out-of-enum value),
 * and a bad report must surface as a retryable error rather than a row of
 * garbage in `reports`.
 */
export function parseAnalysis(raw: string): AnalysisResult {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`analysis response is not valid JSON: ${err}`);
  }

  const headline = parsed.headline;
  if (typeof headline !== "string" || headline.trim() === "") {
    throw new Error("analysis response has no headline");
  }

  const decision = parsed.notification_decision;
  if (
    decision !== "silent" && decision !== "report_ready" &&
    decision !== "observation"
  ) {
    throw new Error(`invalid notification_decision: ${String(decision)}`);
  }

  const forwardRaw = parsed.forward_looking;
  if (forwardRaw !== undefined && forwardRaw !== null && !Array.isArray(forwardRaw)) {
    throw new Error("forward_looking is not an array");
  }
  const forward_looking: ForwardLookingItem[] = (forwardRaw ?? [])
    .map((item: unknown) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const days = Number(obj.revisit_in_days);
      return {
        topic: String(obj.topic ?? ""),
        question: String(obj.question ?? ""),
        revisit_in_days: Number.isFinite(days) ? days : null,
      };
    })
    .filter((item) => item.topic !== "" || item.question !== "");

  return {
    headline,
    changes: asStringArray(parsed.changes, "changes"),
    consistencies: asStringArray(parsed.consistencies, "consistencies"),
    taxonomy_notes: asStringArray(parsed.taxonomy_notes, "taxonomy_notes"),
    forward_looking,
    full_content: typeof parsed.full_content === "string" ? parsed.full_content : "",
    notification_decision: decision,
    model_notes: typeof parsed.model_notes === "string" ? parsed.model_notes : null,
  };
}

export interface FollowUp {
  run_at: string;
  prompt: string;
}

/**
 * Turns forward_looking entries into scheduled_analyses rows. Only items that
 * asked for a revisit produce one — the rest are commentary that lives in the
 * report and nowhere else.
 */
export function followUpsFrom(
  result: AnalysisResult,
  now: Date,
): FollowUp[] {
  return result.forward_looking
    .filter((item) => (item.revisit_in_days ?? 0) > 0)
    .map((item) => ({
      run_at: new Date(now.getTime() + item.revisit_in_days! * DAY_MS).toISOString(),
      prompt: `${item.topic}: ${item.question}`,
    }));
}

/**
 * The message to send on Telegram, or null when the analysis decided the
 * period is not worth interrupting for.
 */
export function notificationMessage(
  result: AnalysisResult,
  period: Period,
): string | null {
  switch (result.notification_decision) {
    case "silent":
      return null;
    case "report_ready":
      return `📊 Relatório de ${period.start} a ${period.end} pronto.\n\n${result.headline}\n\nEnvie /relatorio para ler o relatório completo.`;
    case "observation":
      return `👁️ ${result.headline}\n\n${result.full_content || result.changes.join("\n")}`;
  }
}
