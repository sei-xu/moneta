// Shapes follow supabase/migrations/, not docs/database-schema.md — the doc
// lists columns (expenses.updated_at, expense_items.created_at) that no
// migration creates.

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  parent_id: string | null;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: string | null;
}

export interface Expense {
  id: string;
  transaction_time: string;
  merchant: string | null;
  amount: string | number;
  currency: string;
  source: string | null;
  notes: string | null;
  category_id: string | null;
  payment_method_id: string | null;
  created_at: string;
}

export interface ExpenseItem {
  id: string;
  expense_id: string;
  description: string;
  quantity: string | number | null;
  unit_price: string | number | null;
  total: string | number | null;
}

export interface CategorySummaryRow {
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  month: string;
  expense_count: number;
  total_amount: string | number;
  avg_amount: string | number;
}

export interface QueueStatusRow {
  status: string;
  count: number;
  oldest_age_hours: number | null;
  avg_attempts: string | number | null;
}

export interface ProcessingMetrics {
  total_processed: number;
  successful_resolutions: number;
  success_rate_percent: string | number | null;
  error_count: number;
  awaiting_user: number;
  avg_attempts_per_record: string | number | null;
  needs_detail_count: number;
  duplicate_detections: number;
}

export interface PaymentUsageRow {
  id: string | null;
  payment_method: string | null;
  payment_type: string | null;
  usage_count: number;
  total_amount: string | number;
  last_used: string | null;
}

export type NotificationDecision = "silent" | "report_ready" | "observation";

export type TaxonomyNoteKind = "behavior_tag" | "category";

export interface TaxonomyNote {
  kind: TaxonomyNoteKind;
  name: string;
  rationale: string;
  trigger_pattern?: string | null;
  example_merchants?: string[] | null;
  parent_category?: string | null;
}

export type TaxonomyCandidateStatus = "candidate" | "approved" | "rejected";

export interface BehaviorTag {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  trigger_pattern: string | null;
  example_items: string[];
  status: TaxonomyCandidateStatus;
  source_report_id: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface CategoryCandidate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: TaxonomyCandidateStatus;
  source_report_id: string | null;
  parent_id: string | null;
}

export interface ForwardLookingItem {
  topic?: string;
  question?: string;
  revisit_in_days?: number | null;
}

export interface Report {
  id: string;
  period_start: string;
  period_end: string;
  report_type: string;
  headline: string | null;
  changes: string[];
  consistencies: string[];
  taxonomy_notes: (string | TaxonomyNote)[];
  forward_looking: ForwardLookingItem[];
  full_content: string | null;
  notification_decision: NotificationDecision;
  model_notes: string | null;
  model_used: string | null;
  created_at: string;
}
