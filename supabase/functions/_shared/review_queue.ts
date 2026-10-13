// Pure logic behind the review queue shared by notify-pending-review and
// telegram-ingest's /revisar: what counts as reviewable (waiting_user +
// error — see get_pending_review_queue()), how it groups by sender, when a
// reminder is due, and how a single row renders as a Telegram card. Nothing
// here touches the network, Supabase or the environment, so it is exercised
// directly by `deno test`.

export type ReviewableStatus = "waiting_user" | "error";

export interface ReviewQueueRow {
  id: string;
  telegram_chat_id: string | null;
  status: ReviewableStatus;
  parsed_data: Record<string, unknown> | null;
  image_url: string | null;
  raw_input: string | null;
  attempts: number;
  created_at: string;
  age_hours: number;
}

export interface CategorySuggestion {
  id: string;
  name: string;
  confidence: number;
}

export function merchantOf(row: ReviewQueueRow): string | null {
  const merchant = row.parsed_data?.merchant;
  return typeof merchant === "string" ? merchant : null;
}

export function amountOf(row: ReviewQueueRow): number {
  const amount = row.parsed_data?.amount;
  return typeof amount === "number" ? amount : 0;
}

export function currencyOf(row: ReviewQueueRow): string {
  const currency = row.parsed_data?.currency;
  return typeof currency === "string" ? currency : "BRL";
}

export function hasAmount(row: ReviewQueueRow): boolean {
  return typeof row.parsed_data?.amount === "number";
}

export function errorReason(row: ReviewQueueRow): string | null {
  const reason = row.parsed_data?.error;
  return typeof reason === "string" ? reason : null;
}

/** Groups rows by sender; a null telegram_chat_id is its own group. */
export function groupByChat(rows: ReviewQueueRow[]): Map<string | null, ReviewQueueRow[]> {
  const groups = new Map<string | null, ReviewQueueRow[]>();
  for (const row of rows) {
    const key = row.telegram_chat_id;
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return groups;
}

export interface ChatNotification {
  chatId: string;
  /** Reviewable count for that sender — the same number /revisar lists. */
  count: number;
}

export interface NotificationPlan {
  notified: ChatNotification[];
  orphans: number;
}

/**
 * Decides who gets a reminder and how many rows each should be told about.
 * A chat is notified only when it has at least one row older than
 * `minAgeHours` — that age gate decides *whether* to notify, not the count
 * reported, which is always the sender's full reviewable total so it
 * matches what /revisar then lists.
 *
 * Rows with no telegram_chat_id, or whose chat is outside `allowedChatIds`,
 * cannot be told apart from their actual sender, so they are never sent a
 * reminder of their own — they are only counted as `orphans`, folded by the
 * caller into the first notified chat's message.
 */
export function buildNotifications(
  rows: ReviewQueueRow[],
  allowedChatIds: string[],
  minAgeHours: number,
): NotificationPlan {
  const allowed = new Set(allowedChatIds);
  const byChat = groupByChat(rows);

  let orphans = 0;
  const notified: ChatNotification[] = [];

  for (const [chatId, chatRows] of byChat) {
    if (chatId === null || !allowed.has(chatId)) {
      orphans += chatRows.length;
      continue;
    }
    const hasOldRow = chatRows.some((row) => row.age_hours >= minAgeHours);
    if (hasOldRow) {
      notified.push({ chatId, count: chatRows.length });
    }
  }

  notified.sort((a, b) => a.chatId.localeCompare(b.chatId));
  return { notified, orphans };
}

export function notificationText(count: number): string {
  return `📌 Você tem ${count} gasto${count === 1 ? "" : "s"} para revisar\n\nMande /revisar para começar`;
}

export function orphanNote(count: number): string {
  return `📎 ${count} recibo${count === 1 ? "" : "s"} sem remetente conhecido.`;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface ReviewCard {
  text: string;
  keyboard: { inline_keyboard: InlineButton[][] };
}

function formatWaitingUserText(row: ReviewQueueRow, suggestions: CategorySuggestion[]): string {
  const merchant = merchantOf(row) ?? "Despesa";
  let msg = `📋 ${merchant} — R$ ${amountOf(row).toFixed(2)} ${currencyOf(row)}\n`;

  const items = row.parsed_data?.items;
  if (Array.isArray(items) && items.length > 0) {
    msg += `Itens: ${
      (items as Array<{ description?: string }>).map((i) => i.description).join(", ")
    }\n`;
  }

  if (suggestions.length > 0) {
    msg += "\n💡 Categorias sugeridas:\n";
    suggestions.forEach((s, i) => {
      msg += `${i + 1}. ${s.name} (${(s.confidence * 100).toFixed(0)}%)\n`;
    });
  }

  return msg;
}

function buildWaitingUserCard(row: ReviewQueueRow, suggestions: CategorySuggestion[]): ReviewCard {
  return {
    text: formatWaitingUserText(row, suggestions),
    keyboard: {
      inline_keyboard: [
        [
          { text: "👁️ Ver nota", callback_data: `ver:${row.id}` },
          { text: "📝 Classificar", callback_data: `classificar:${row.id}` },
        ],
        [
          { text: "✏️ Corrigir valor", callback_data: `corrigir:${row.id}` },
          { text: "✅ Confirmar", callback_data: `confirmar:${row.id}` },
        ],
        [
          { text: "⏰ Mais tarde", callback_data: `depois:${row.id}` },
          { text: "🗑️ Descartar", callback_data: `descartar:${row.id}` },
        ],
      ],
    },
  };
}

function buildErrorCard(row: ReviewQueueRow): ReviewCard {
  const reason = errorReason(row) ?? "motivo não registrado";
  return {
    text: `⚠️ Falha ao processar este recibo (${row.attempts} tentativa${row.attempts === 1 ? "" : "s"})\n${reason}`,
    keyboard: {
      inline_keyboard: [
        [{ text: "🔄 Tentar de novo", callback_data: `retry:${row.id}` }],
        [{ text: "👁️ Ver nota", callback_data: `ver:${row.id}` }],
        [{ text: "🗑️ Descartar", callback_data: `descartar:${row.id}` }],
      ],
    },
  };
}

/**
 * Renders one row as a Telegram card. 'error' rows have no amount or
 * merchant to confirm or classify — parsing never ran to completion — so
 * they get a dedicated card with a retry action instead of Confirmar/Classificar.
 */
export function buildReviewCard(
  row: ReviewQueueRow,
  suggestions: CategorySuggestion[] = [],
): ReviewCard {
  if (row.status === "error") return buildErrorCard(row);
  return buildWaitingUserCard(row, suggestions);
}
