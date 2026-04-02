export type PatientMcsApiLink = {
  id: string;
  source_url: string;
  mcs_patient_id: string | null;
  mcs_patient_url: string | null;
  mcs_project_id: string | null;
  mcs_project_url: string | null;
  project_title: string | null;
  project_memo: string | null;
  member_count: number | null;
  last_sync_attempt_at: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};

export type PatientMcsApiSummary = {
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
  latest_posted_at: string | null;
  generated_at: string;
  duration_ms: number | null;
};

export type PatientMcsApiMessage = {
  id: string;
  source_message_id: string;
  author_name: string;
  author_role: string | null;
  author_organization: string | null;
  author_descriptor: string | null;
  posted_at: string | null;
  posted_at_label: string;
  body: string;
  reaction_count: number;
  reply_count: number;
  sort_order: number | null;
  source_url: string;
  synced_at: string;
};

export type PatientMcsViewLink = {
  id: string;
  sourceUrl: string;
  patientUrl: string | null;
  projectId: string | null;
  projectUrl: string | null;
  projectTitle: string | null;
  projectMemo: string | null;
  memberCount: number | null;
  lastSyncAttemptAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
};

export type PatientMcsViewSummary = {
  id: string;
  generationId: string;
  provider: string;
  requestedProvider: string;
  isFallback: boolean;
  model: string | null;
  fallbackReason: string | null;
  headline: string;
  bullets: string[];
  mustCheckToday: string[];
  suggestedActions: string[];
  sourceRefs: string[];
  messageCount: number;
  otherProfessionalMessageCount: number;
  latestPostedAt: string | null;
  generatedAt: string;
  durationMs: number | null;
};

export type PatientMcsViewMessage = {
  id: string;
  sourceMessageId: string;
  authorName: string;
  authorRole: string | null;
  authorOrganization: string | null;
  authorDescriptor: string | null;
  postedAt: string | null;
  postedAtLabel: string;
  body: string;
  reactionCount: number;
  replyCount: number;
  sortOrder: number | null;
  sourceUrl: string;
  syncedAt: string;
};

export type PatientMcsViewData = {
  patient: {
    id: string;
    name: string;
  };
  link: PatientMcsViewLink | null;
  summary: PatientMcsViewSummary | null;
  messages: PatientMcsViewMessage[];
};

export type PatientMcsSyncViewResult = {
  importedCount: number;
  latestMessageAt: string | null;
  projectTitle: string | null;
  summary: PatientMcsViewSummary | null;
};

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function parsePatientMcsViewSummary(
  summary: PatientMcsApiSummary | null | undefined
): PatientMcsViewSummary | null {
  if (!summary) return null;

  return {
    id: summary.id,
    generationId: summary.generation_id,
    provider: summary.provider,
    requestedProvider: summary.requested_provider,
    isFallback: summary.is_fallback,
    model: summary.model,
    fallbackReason: summary.fallback_reason,
    headline: summary.headline,
    bullets: toStringArray(summary.bullets),
    mustCheckToday: toStringArray(summary.must_check_today),
    suggestedActions: toStringArray(summary.suggested_actions),
    sourceRefs: toStringArray(summary.source_refs),
    messageCount: summary.message_count,
    otherProfessionalMessageCount: summary.other_professional_message_count,
    latestPostedAt: summary.latest_posted_at,
    generatedAt: summary.generated_at,
    durationMs: summary.duration_ms,
  };
}

export function parsePatientMcsViewData(payload: {
  data: {
    patient: { id: string; name: string };
    link: PatientMcsApiLink | null;
    summary: PatientMcsApiSummary | null;
    messages: PatientMcsApiMessage[];
  };
}): PatientMcsViewData {
  return {
    patient: payload.data.patient,
    link: payload.data.link
      ? {
          id: payload.data.link.id,
          sourceUrl: payload.data.link.source_url,
          patientUrl: payload.data.link.mcs_patient_url,
          projectId: payload.data.link.mcs_project_id,
          projectUrl: payload.data.link.mcs_project_url,
          projectTitle: payload.data.link.project_title,
          projectMemo: payload.data.link.project_memo,
          memberCount: payload.data.link.member_count,
          lastSyncAttemptAt: payload.data.link.last_sync_attempt_at,
          lastSyncedAt: payload.data.link.last_synced_at,
          lastSyncStatus: payload.data.link.last_sync_status,
          lastSyncError: payload.data.link.last_sync_error,
        }
      : null,
    summary: parsePatientMcsViewSummary(payload.data.summary),
    messages: payload.data.messages.map((message) => ({
      id: message.id,
      sourceMessageId: message.source_message_id,
      authorName: message.author_name,
      authorRole: message.author_role,
      authorOrganization: message.author_organization,
      authorDescriptor: message.author_descriptor,
      postedAt: message.posted_at,
      postedAtLabel: message.posted_at_label,
      body: message.body,
      reactionCount: message.reaction_count,
      replyCount: message.reply_count,
      sortOrder: message.sort_order,
      sourceUrl: message.source_url,
      syncedAt: message.synced_at,
    })),
  };
}

export function parsePatientMcsSyncResult(payload: {
  data: {
    importedCount: number;
    latestMessageAt?: string | null;
    link?: {
      project_title?: string | null;
    } | null;
    summary?: PatientMcsApiSummary | null;
  };
}): PatientMcsSyncViewResult {
  return {
    importedCount: payload.data.importedCount,
    latestMessageAt: payload.data.latestMessageAt ?? null,
    projectTitle: payload.data.link?.project_title ?? null,
    summary: parsePatientMcsViewSummary(payload.data.summary),
  };
}
