// Run with: deno test supabase/functions/analyze-expenses/

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AnalysisResult,
  buildPrompt,
  followUpsFrom,
  isRetryableStatus,
  notificationMessage,
  parseAnalysis,
  previousIsoWeek,
  taxonomyCandidatesFrom,
} from "./analysis.ts";

function validPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    headline: "Semana dentro da média",
    changes: ["Mercado subiu 12%"],
    consistencies: ["Transporte estável"],
    taxonomy_notes: [],
    forward_looking: [],
    full_content: "# Relatório\n\nTudo certo.",
    notification_decision: "report_ready",
    model_notes: null,
    ...overrides,
  });
}

Deno.test("previousIsoWeek returns the Monday–Sunday before the current week", () => {
  // Wednesday 2026-09-30 → previous ISO week is 2026-09-21..2026-09-27
  assertEquals(previousIsoWeek(new Date("2026-09-30T12:00:00Z")), {
    start: "2026-09-21",
    end: "2026-09-27",
  });
});

Deno.test("previousIsoWeek treats Sunday as the last day of its week", () => {
  // Sunday 2026-09-27 still belongs to the week starting 2026-09-21,
  // so the previous week is 2026-09-14..2026-09-20
  assertEquals(previousIsoWeek(new Date("2026-09-27T23:59:00Z")), {
    start: "2026-09-14",
    end: "2026-09-20",
  });
});

Deno.test("previousIsoWeek crosses a year boundary", () => {
  // Monday 2027-01-04 → previous week spans into 2026
  assertEquals(previousIsoWeek(new Date("2027-01-04T00:00:00Z")), {
    start: "2026-12-28",
    end: "2027-01-03",
  });
});

Deno.test("buildPrompt embeds the context and omits the follow-up section", () => {
  const prompt = buildPrompt({ totals: { amount: 120 } });
  assertStringIncludes(prompt, '"amount": 120');
  assertEquals(prompt.includes("análise de acompanhamento"), false);
});

Deno.test("buildPrompt includes a custom follow-up prompt when given", () => {
  const prompt = buildPrompt({ totals: {} }, "Delivery voltou a subir?");
  assertStringIncludes(prompt, "Delivery voltou a subir?");
  assertStringIncludes(prompt, "análise de acompanhamento");
});

Deno.test("parseAnalysis accepts a well-formed payload", () => {
  const result = parseAnalysis(validPayload());
  assertEquals(result.headline, "Semana dentro da média");
  assertEquals(result.notification_decision, "report_ready");
  assertEquals(result.changes, ["Mercado subiu 12%"]);
});

Deno.test("parseAnalysis strips a markdown code fence", () => {
  const result = parseAnalysis("```json\n" + validPayload() + "\n```");
  assertEquals(result.headline, "Semana dentro da média");
});

Deno.test("parseAnalysis rejects malformed JSON", () => {
  assertThrows(
    () => parseAnalysis("{not json"),
    Error,
    "not valid JSON",
  );
});

Deno.test("parseAnalysis rejects a missing headline", () => {
  assertThrows(
    () => parseAnalysis(validPayload({ headline: "" })),
    Error,
    "no headline",
  );
});

Deno.test("parseAnalysis rejects a decision outside the enum", () => {
  assertThrows(
    () => parseAnalysis(validPayload({ notification_decision: "maybe" })),
    Error,
    "invalid notification_decision",
  );
});

Deno.test("parseAnalysis defaults absent optional arrays to empty", () => {
  const raw = JSON.stringify({
    headline: "ok",
    full_content: "",
    notification_decision: "silent",
  });
  const result = parseAnalysis(raw);
  assertEquals(result.changes, []);
  assertEquals(result.forward_looking, []);
  assertEquals(result.model_notes, null);
});

Deno.test("followUpsFrom schedules only items that asked for a revisit", () => {
  const result = parseAnalysis(validPayload({
    forward_looking: [
      { topic: "Delivery", question: "Voltou a subir?", revisit_in_days: 14 },
      { topic: "Mercado", question: "Só uma observação." },
    ],
  })) as AnalysisResult;

  const now = new Date("2026-09-30T00:00:00Z");
  const followUps = followUpsFrom(result, now);

  assertEquals(followUps.length, 1);
  assertEquals(followUps[0].run_at, "2026-10-14T00:00:00.000Z");
  assertStringIncludes(followUps[0].prompt, "Delivery");
});

Deno.test("isRetryableStatus retries upstream blips but not caller errors", () => {
  // 503 is what Gemini actually returned under load during the first
  // production run, and 429 is the free-tier rate limit
  for (const status of [429, 500, 502, 503, 504]) {
    assertEquals(isRetryableStatus(status), true, `${status} should retry`);
  }
  // a bad key, an unknown model or a malformed request fail identically on
  // a second attempt, so retrying only burns the run
  for (const status of [400, 401, 403, 404, 422]) {
    assertEquals(isRetryableStatus(status), false, `${status} should not retry`);
  }
});

Deno.test("notificationMessage stays quiet on a silent decision", () => {
  const result = parseAnalysis(validPayload({ notification_decision: "silent" }));
  assertEquals(
    notificationMessage(result, { start: "2026-09-21", end: "2026-09-27" }),
    null,
  );
});

Deno.test("notificationMessage points to /relatorio when a report is ready", () => {
  const result = parseAnalysis(validPayload());
  const text = notificationMessage(result, { start: "2026-09-21", end: "2026-09-27" })!;
  assertStringIncludes(text, "/relatorio");
  assertStringIncludes(text, "2026-09-21");
});

Deno.test("parseAnalysis accepts structured taxonomy_notes objects", () => {
  const result = parseAnalysis(validPayload({
    taxonomy_notes: [
      {
        kind: "behavior_tag",
        name: "Compra por impulso",
        rationale: "Picos fora do padrão em compras pequenas de madrugada.",
        trigger_pattern: "horário entre 00h-04h",
        example_merchants: ["Loja X"],
      },
      {
        kind: "category",
        name: "Pet Shop",
        rationale: "Gasto recorrente sem categoria própria.",
        parent_category: "Saúde",
      },
    ],
  }));
  assertEquals(result.taxonomy_notes.length, 2);
  assertEquals(result.taxonomy_notes[0].kind, "behavior_tag");
  assertEquals(result.taxonomy_notes[0].name, "Compra por impulso");
  assertEquals(result.taxonomy_notes[1].kind, "category");
  assertEquals(result.taxonomy_notes[1].parent_category, "Saúde");
});

Deno.test("parseAnalysis normalizes a legacy string taxonomy_notes entry", () => {
  const result = parseAnalysis(validPayload({
    taxonomy_notes: ["Assinaturas de streaming"],
  }));
  assertEquals(result.taxonomy_notes, [
    { kind: "behavior_tag", name: "Assinaturas de streaming", rationale: "" },
  ]);
});

Deno.test("parseAnalysis rejects a taxonomy_notes kind outside the enum", () => {
  assertThrows(
    () =>
      parseAnalysis(validPayload({
        taxonomy_notes: [{ kind: "venue", name: "X", rationale: "Y" }],
      })),
    Error,
    "invalid taxonomy_notes kind",
  );
});

Deno.test("taxonomyCandidatesFrom separates behavior tags from categories and slugifies without accents", () => {
  const result = parseAnalysis(validPayload({
    taxonomy_notes: [
      { kind: "behavior_tag", name: "Compra por impulso", rationale: "r1" },
      { kind: "category", name: "Saúde Animal", rationale: "r2" },
    ],
  })) as AnalysisResult;

  const candidates = taxonomyCandidatesFrom(result, "report-1");
  assertEquals(candidates.length, 2);
  assertEquals(candidates[0].kind, "behavior_tag");
  assertEquals(candidates[0].slug, "compra-por-impulso");
  assertEquals(candidates[1].kind, "category");
  assertEquals(candidates[1].slug, "saude-animal");
});

Deno.test("taxonomyCandidatesFrom deduplicates by slug within the same report", () => {
  const result = parseAnalysis(validPayload({
    taxonomy_notes: [
      { kind: "behavior_tag", name: "Compra por Impulso", rationale: "r1" },
      { kind: "behavior_tag", name: "compra por impulso!", rationale: "r2" },
    ],
  })) as AnalysisResult;

  const candidates = taxonomyCandidatesFrom(result, "report-1");
  assertEquals(candidates.length, 1);
});

Deno.test("taxonomyCandidatesFrom returns an empty list when there are no notes (the normal case)", () => {
  const result = parseAnalysis(validPayload({ taxonomy_notes: [] })) as AnalysisResult;
  assertEquals(taxonomyCandidatesFrom(result, "report-1"), []);
});

Deno.test("notificationMessage delivers the finding itself on an observation", () => {
  const result = parseAnalysis(validPayload({
    notification_decision: "observation",
    full_content: "Gasto com mercado dobrou.",
  }));
  const text = notificationMessage(result, { start: "2026-09-21", end: "2026-09-27" })!;
  assertStringIncludes(text, "Gasto com mercado dobrou.");
  assertEquals(text.includes("/relatorio"), false);
});
