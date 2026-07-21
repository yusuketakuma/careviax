export type PatientMcsLinkRecord = {
  id: string;
  source_url: string;
  mcs_patient_id: string | null;
  mcs_patient_url: string | null;
  mcs_project_id: string | null;
  mcs_project_url: string | null;
  project_title: string | null;
  project_memo: string | null;
  member_count: number | null;
  last_sync_attempt_at: Date | null;
  last_synced_at: Date | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};

export type PatientMcsMessageRecord = {
  id: string;
  source_message_id: string;
  author_name: string;
  author_role: string | null;
  author_organization: string | null;
  author_descriptor: string | null;
  posted_at: Date | null;
  posted_at_label: string;
  body: string;
  reaction_count: number;
  reply_count: number;
  sort_order: number | null;
  source_url: string;
  synced_at: Date;
};

export type PatientMcsCheckLogRecord = {
  id: string;
  subject: string | null;
  content: string | null;
  counterpart_name: string | null;
  occurred_at: Date;
  created_at: Date;
};

export type PatientMcsProfileRecord = {
  linked_status: string | null;
  participation_status: string | null;
  pharmacy_participants: string[];
  counterpart_roles: string[];
  last_checked_at: Date | null;
  note: string | null;
  updated_at: Date | null;
};

export type PatientMcsOverview = {
  link: PatientMcsLinkRecord | null;
  profile: PatientMcsProfileRecord | null;
  summary: PatientMcsSummaryRecord | null;
  messages: PatientMcsMessageRecord[];
  checkLogs: PatientMcsCheckLogRecord[];
};

export type PatientMcsSyncResult = {
  link: PatientMcsLinkRecord;
  summary: PatientMcsSummaryRecord | null;
  importedCount: number;
  latestMessageAt: Date | null;
};

export type PatientMcsSummaryRecord = {
  id: string;
  generation_id: string;
  provider: string;
  requested_provider: string;
  is_fallback: boolean;
  model: string | null;
  fallback_reason: string | null;
  headline: string;
  bullets: string[];
  must_check_today: string[];
  suggested_actions: string[];
  source_refs: string[];
  message_count: number;
  other_professional_message_count: number;
  latest_posted_at: Date | null;
  generated_at: Date;
  duration_ms: number | null;
};
