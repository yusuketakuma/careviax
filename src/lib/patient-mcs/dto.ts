import { readJsonObject } from '@/lib/db/json';

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

function failInvalidPatientMcsPayload(): never {
  throw new Error('MCS レスポンス形式が不正です');
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readNullableString(value: unknown) {
  return typeof value === 'string' || value === null ? value : undefined;
}

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNullableFiniteNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;
}

function readPatient(value: unknown): PatientMcsViewData['patient'] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  const id = readString(object.id);
  const name = readString(object.name);
  return id && name ? { id, name } : null;
}

function parsePatientMcsViewLink(link: unknown): PatientMcsViewLink | null | undefined {
  if (link === null) return null;
  const object = readJsonObject(link);
  if (!object) return undefined;

  const id = readString(object.id);
  const sourceUrl = readString(object.source_url);
  const patientUrl = readNullableString(object.mcs_patient_url);
  const projectId = readNullableString(object.mcs_project_id);
  const projectUrl = readNullableString(object.mcs_project_url);
  const projectTitle = readNullableString(object.project_title);
  const projectMemo = readNullableString(object.project_memo);
  const memberCount = readNullableFiniteNumber(object.member_count);
  const lastSyncAttemptAt = readNullableString(object.last_sync_attempt_at);
  const lastSyncedAt = readNullableString(object.last_synced_at);
  const lastSyncStatus = readNullableString(object.last_sync_status);
  const lastSyncError = readNullableString(object.last_sync_error);

  if (
    !id ||
    !sourceUrl ||
    patientUrl === undefined ||
    projectId === undefined ||
    projectUrl === undefined ||
    projectTitle === undefined ||
    projectMemo === undefined ||
    memberCount === undefined ||
    lastSyncAttemptAt === undefined ||
    lastSyncedAt === undefined ||
    lastSyncStatus === undefined ||
    lastSyncError === undefined
  ) {
    return undefined;
  }

  return {
    id,
    sourceUrl,
    patientUrl,
    projectId,
    projectUrl,
    projectTitle,
    projectMemo,
    memberCount,
    lastSyncAttemptAt,
    lastSyncedAt,
    lastSyncStatus,
    lastSyncError,
  };
}

function parsePatientMcsViewSummary(summary: unknown): PatientMcsViewSummary | null {
  if (summary === null || summary === undefined) return null;
  const object = readJsonObject(summary);
  if (!object) return failInvalidPatientMcsPayload();

  const id = readString(object.id);
  const generationId = readString(object.generation_id);
  const provider = readString(object.provider);
  const requestedProvider = readString(object.requested_provider);
  const model = readNullableString(object.model);
  const fallbackReason = readNullableString(object.fallback_reason);
  const headline = readString(object.headline);
  const messageCount = readFiniteNumber(object.message_count);
  const otherProfessionalMessageCount = readFiniteNumber(object.other_professional_message_count);
  const latestPostedAt = readNullableString(object.latest_posted_at);
  const generatedAt = readString(object.generated_at);
  const durationMs = readNullableFiniteNumber(object.duration_ms);

  if (
    !id ||
    !generationId ||
    !provider ||
    !requestedProvider ||
    typeof object.is_fallback !== 'boolean' ||
    model === undefined ||
    fallbackReason === undefined ||
    !headline ||
    messageCount === null ||
    otherProfessionalMessageCount === null ||
    latestPostedAt === undefined ||
    !generatedAt ||
    durationMs === undefined
  ) {
    return failInvalidPatientMcsPayload();
  }

  return {
    id,
    generationId,
    provider,
    requestedProvider,
    isFallback: object.is_fallback,
    model,
    fallbackReason,
    headline,
    bullets: toStringArray(object.bullets),
    mustCheckToday: toStringArray(object.must_check_today),
    suggestedActions: toStringArray(object.suggested_actions),
    sourceRefs: toStringArray(object.source_refs),
    messageCount,
    otherProfessionalMessageCount,
    latestPostedAt,
    generatedAt,
    durationMs,
  };
}

function parsePatientMcsViewMessage(message: unknown): PatientMcsViewMessage | null {
  const object = readJsonObject(message);
  if (!object) return null;

  const id = readString(object.id);
  const sourceMessageId = readString(object.source_message_id);
  const authorName = readString(object.author_name);
  const authorRole = readNullableString(object.author_role);
  const authorOrganization = readNullableString(object.author_organization);
  const authorDescriptor = readNullableString(object.author_descriptor);
  const postedAt = readNullableString(object.posted_at);
  const postedAtLabel = readString(object.posted_at_label);
  const body = readString(object.body);
  const reactionCount = readFiniteNumber(object.reaction_count);
  const replyCount = readFiniteNumber(object.reply_count);
  const sortOrder = readNullableFiniteNumber(object.sort_order);
  const sourceUrl = readString(object.source_url);
  const syncedAt = readString(object.synced_at);

  if (
    !id ||
    !sourceMessageId ||
    !authorName ||
    authorRole === undefined ||
    authorOrganization === undefined ||
    authorDescriptor === undefined ||
    postedAt === undefined ||
    !postedAtLabel ||
    body === null ||
    reactionCount === null ||
    replyCount === null ||
    sortOrder === undefined ||
    !sourceUrl ||
    !syncedAt
  ) {
    return null;
  }

  return {
    id,
    sourceMessageId,
    authorName,
    authorRole,
    authorOrganization,
    authorDescriptor,
    postedAt,
    postedAtLabel,
    body,
    reactionCount,
    replyCount,
    sortOrder,
    sourceUrl,
    syncedAt,
  };
}

function isPatientMcsViewMessage(
  message: PatientMcsViewMessage | null,
): message is PatientMcsViewMessage {
  return message !== null;
}

export function parsePatientMcsViewData(payload: unknown): PatientMcsViewData {
  const root = readJsonObject(payload);
  const data = readJsonObject(root?.data);
  if (!data || !Array.isArray(data.messages)) return failInvalidPatientMcsPayload();

  const patient = readPatient(data.patient);
  const link = parsePatientMcsViewLink(data.link);
  const messages = data.messages.map(parsePatientMcsViewMessage);
  if (!patient || link === undefined || !messages.every(isPatientMcsViewMessage)) {
    return failInvalidPatientMcsPayload();
  }

  return {
    patient,
    link,
    summary: parsePatientMcsViewSummary(data.summary),
    messages,
  };
}

function readSyncProjectTitle(link: unknown) {
  if (link === null || link === undefined) return null;
  const object = readJsonObject(link);
  if (!object) return undefined;
  const projectTitle =
    object.project_title === undefined ? null : readNullableString(object.project_title);
  return projectTitle;
}

export function parsePatientMcsSyncResult(payload: unknown): PatientMcsSyncViewResult {
  const root = readJsonObject(payload);
  const data = readJsonObject(root?.data);
  if (!data) return failInvalidPatientMcsPayload();

  const importedCount = readFiniteNumber(data.importedCount);
  const latestMessageAt =
    data.latestMessageAt === undefined ? null : readNullableString(data.latestMessageAt);
  const projectTitle = readSyncProjectTitle(data.link);
  if (importedCount === null || latestMessageAt === undefined || projectTitle === undefined) {
    return failInvalidPatientMcsPayload();
  }

  return {
    importedCount,
    latestMessageAt,
    projectTitle,
    summary: parsePatientMcsViewSummary(data.summary),
  };
}
