// Run with: deno test supabase/functions/_shared/

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  amountOf,
  buildNotifications,
  buildReviewCard,
  errorReason,
  groupByChat,
  hasAmount,
  merchantOf,
  notificationText,
  orphanNote,
  type ReviewQueueRow,
} from "./review_queue.ts";

function row(overrides: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    telegram_chat_id: "100",
    status: "waiting_user",
    parsed_data: { merchant: "Mercado XYZ", amount: 150.5, currency: "BRL" },
    image_url: null,
    raw_input: "raw text",
    attempts: 0,
    created_at: "2026-10-01T00:00:00Z",
    age_hours: 0,
    ...overrides,
  };
}

Deno.test("groupByChat groups rows by sender, keeping a null chat as its own group", () => {
  const rows = [
    row({ id: "a", telegram_chat_id: "100" }),
    row({ id: "b", telegram_chat_id: "200" }),
    row({ id: "c", telegram_chat_id: "100" }),
    row({ id: "d", telegram_chat_id: null }),
  ];
  const groups = groupByChat(rows);
  assertEquals(groups.get("100")?.map((r) => r.id), ["a", "c"]);
  assertEquals(groups.get("200")?.map((r) => r.id), ["b"]);
  assertEquals(groups.get(null)?.map((r) => r.id), ["d"]);
});

Deno.test("buildNotifications notifies each allowed sender with its own count, not the global total", () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => row({ id: `a${i}`, telegram_chat_id: "100", age_hours: 30 })),
    ...Array.from({ length: 2 }, (_, i) => row({ id: `b${i}`, telegram_chat_id: "200", age_hours: 30 })),
  ];
  const plan = buildNotifications(rows, ["100", "200"], 24);
  assertEquals(plan.notified, [{ chatId: "100", count: 9 }, { chatId: "200", count: 2 }]);
  assertEquals(plan.orphans, 0);
});

Deno.test("buildNotifications skips a sender whose rows are all younger than the age gate", () => {
  const rows = [
    row({ id: "a", telegram_chat_id: "100", age_hours: 30 }),
    row({ id: "b", telegram_chat_id: "200", age_hours: 2 }),
  ];
  const plan = buildNotifications(rows, ["100", "200"], 24);
  assertEquals(plan.notified, [{ chatId: "100", count: 1 }]);
});

Deno.test("buildNotifications counts every row for a notified chat, even the young ones", () => {
  const rows = [
    row({ id: "a", telegram_chat_id: "100", age_hours: 30 }),
    row({ id: "b", telegram_chat_id: "100", age_hours: 1 }),
  ];
  const plan = buildNotifications(rows, ["100"], 24);
  assertEquals(plan.notified, [{ chatId: "100", count: 2 }]);
});

Deno.test("buildNotifications folds a null chat and a disallowed chat into orphans, never as their own notification", () => {
  const rows = [
    row({ id: "a", telegram_chat_id: null, age_hours: 999 }),
    row({ id: "b", telegram_chat_id: "999", age_hours: 999 }), // not in allowedChatIds
    row({ id: "c", telegram_chat_id: "100", age_hours: 30 }),
  ];
  const plan = buildNotifications(rows, ["100"], 24);
  assertEquals(plan.notified, [{ chatId: "100", count: 1 }]);
  assertEquals(plan.orphans, 2);
});

Deno.test("buildNotifications orders notified chats deterministically by chat id", () => {
  const rows = [
    row({ id: "a", telegram_chat_id: "200", age_hours: 30 }),
    row({ id: "b", telegram_chat_id: "100", age_hours: 30 }),
  ];
  const plan = buildNotifications(rows, ["100", "200"], 24);
  assertEquals(plan.notified.map((n) => n.chatId), ["100", "200"]);
});

Deno.test("notificationText pluralizes correctly", () => {
  assertEquals(notificationText(1), "📌 Você tem 1 gasto para revisar\n\nMande /revisar para começar");
  assertEquals(notificationText(9), "📌 Você tem 9 gastos para revisar\n\nMande /revisar para começar");
});

Deno.test("orphanNote pluralizes correctly", () => {
  assertEquals(orphanNote(1), "📎 1 recibo sem remetente conhecido.");
  assertEquals(orphanNote(2), "📎 2 recibos sem remetente conhecido.");
});

Deno.test("hasAmount / merchantOf / amountOf read from parsed_data, with safe defaults", () => {
  const withAmount = row({ parsed_data: { merchant: "Padaria", amount: 12 } });
  assert(hasAmount(withAmount));
  assertEquals(merchantOf(withAmount), "Padaria");
  assertEquals(amountOf(withAmount), 12);

  const withoutAmount = row({ parsed_data: { error: "boom" } });
  assertFalse(hasAmount(withoutAmount));
  assertEquals(merchantOf(withoutAmount), null);
  assertEquals(amountOf(withoutAmount), 0);
});

Deno.test("errorReason reads parsed_data.error when it is a string", () => {
  assertEquals(errorReason(row({ parsed_data: { error: "ApiError 503" } })), "ApiError 503");
  assertEquals(errorReason(row({ parsed_data: { merchant: "x" } })), null);
});

Deno.test("buildReviewCard for a waiting_user row shows merchant/amount and the full action set", () => {
  const card = buildReviewCard(row());
  assert(card.text.includes("Mercado XYZ"));
  assert(card.text.includes("150.50"));
  const callbacks = card.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
  assert(callbacks.some((c) => c.startsWith("confirmar:")));
  assert(callbacks.some((c) => c.startsWith("classificar:")));
  assertFalse(callbacks.some((c) => c.startsWith("retry:")));
});

Deno.test("buildReviewCard includes suggested categories when given", () => {
  const card = buildReviewCard(row(), [{ id: "c1", name: "Mercado", confidence: 0.8 }]);
  assert(card.text.includes("Mercado (80%)"));
});

Deno.test("buildReviewCard for an error row shows the failure reason and a retry action, never Confirmar/Classificar", () => {
  const errorRow = row({
    status: "error",
    attempts: 3,
    parsed_data: { error: "ApiError 503 Service Unavailable. {'error': 'high demand'}" },
  });
  const card = buildReviewCard(errorRow);
  assert(card.text.includes("ApiError 503"));
  assert(card.text.includes("3 tentativas"));
  const callbacks = card.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
  assertEquals(callbacks, [`retry:${errorRow.id}`, `ver:${errorRow.id}`, `descartar:${errorRow.id}`]);
});

Deno.test("buildReviewCard for an error row with a single attempt uses singular wording", () => {
  const errorRow = row({ status: "error", attempts: 1, parsed_data: { error: "boom" } });
  const card = buildReviewCard(errorRow);
  assert(card.text.includes("1 tentativa"));
  assertFalse(card.text.includes("1 tentativas"));
});
