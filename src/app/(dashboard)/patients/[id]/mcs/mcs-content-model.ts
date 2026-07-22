import { z } from 'zod';
import { readApiJson, type ApiJsonSchema } from '@/lib/api/client-json';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { apiAcknowledgementSchema, apiDataSchema } from '@/lib/api/response-schemas';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { parsePatientMcsSyncResult } from '@/lib/patient-mcs/dto';
import { PatientMcsOverviewQueryError } from '@/lib/patient-mcs/query';

export const MCS_COPY_URL_FAILURE_MESSAGE =
  'MCS URLのコピーに失敗しました。ブラウザの設定を確認してからもう一度お試しください。';
export const MCS_SYNC_FAILURE_MESSAGE =
  'MCS 連携の同期に失敗しました。連携元URLと通信状態を確認してからもう一度お試しください。';
export const MCS_SYNC_CONFLICT_MESSAGE =
  '連携先と現在の患者情報が一致しないため同期できませんでした。連携元URLを確認してください。';
export const MCS_CHECK_LOG_FAILURE_MESSAGE =
  'MCS 確認ログの登録に失敗しました。入力内容を確認してからもう一度お試しください。';
export const MCS_PROFILE_FAILURE_MESSAGE =
  'MCS 参加情報の保存に失敗しました。入力内容を確認してからもう一度お試しください。';
const MCS_PERMISSION_FAILURE_MESSAGE =
  'MCS 連携を実行する権限がありません。権限を確認してからもう一度お試しください。';
export const MCS_OVERVIEW_ERROR_TITLE = 'MCS 連携情報を表示できません';

const MCS_OVERVIEW_FAILURES = {
  forbidden: {
    variant: 'forbidden',
    cause: 'MCS 連携情報を表示する権限がありません。',
    nextAction: '権限を確認してから再読み込みしてください。',
  },
  failed: {
    variant: 'server',
    cause: 'MCS 連携情報を取得できませんでした。',
    nextAction: '通信状態を確認してから再読み込みしてください。',
  },
} as const;

export const MCS_LINKED_STATUS_OPTIONS = [
  { value: 'unknown', label: '未確認' },
  { value: 'linked', label: '連携あり' },
  { value: 'unlinked', label: '連携なし' },
];

export const MCS_PARTICIPATION_STATUS_OPTIONS = [
  { value: 'unknown', label: '未確認' },
  { value: 'invited', label: '招待済み' },
  { value: 'joined', label: '参加済み' },
  { value: 'not_joined', label: '未参加' },
];

export const MCS_COUNTERPART_ROLE_OPTIONS = [
  { value: 'physician', label: '医師' },
  { value: 'visiting_nurse', label: '訪問看護' },
  { value: 'care_manager', label: 'ケアマネ' },
  { value: 'family', label: '家族' },
  { value: 'facility', label: '施設' },
  { value: 'other', label: 'その他' },
];

export const MCS_LOG_CATEGORY_OPTIONS = [
  { value: 'report', label: '報告確認' },
  { value: 'consultation', label: '相談確認' },
  { value: 'instruction_check', label: '指示確認' },
  { value: 'photo_review', label: '写真確認' },
  { value: 'urgent', label: '緊急確認' },
  { value: 'other', label: 'その他' },
];

export type PatientMcsCheckLogInput = {
  contentType: string;
  summary: string;
  nextAction: string;
};

export type PatientMcsProfileInput = {
  linkedStatus: string;
  participationStatus: string;
  pharmacyParticipants: string[];
  counterpartRoles: string[];
  lastCheckedAt: string | null;
  note: string | null;
};

class PatientMcsMutationResponseError extends Error {
  constructor(
    readonly status: number,
    fallbackMessage: string,
  ) {
    super(fallbackMessage);
    this.name = 'PatientMcsMutationResponseError';
  }
}

const patientMcsSyncResponseSchema = apiDataSchema(z.unknown()).transform((payload, ctx) => {
  try {
    return parsePatientMcsSyncResult(payload);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid patient MCS sync response' });
    return z.NEVER;
  }
});

async function readPatientMcsMutationResponse<T>(
  response: Response,
  fallbackMessage: string,
  schema: ApiJsonSchema<T>,
): Promise<T> {
  if (!response.ok) {
    throw new PatientMcsMutationResponseError(response.status, fallbackMessage);
  }
  return readApiJson(response, { fallbackMessage, schema });
}

export function getPatientMcsMutationStatus(error: unknown): number | null {
  return error instanceof PatientMcsMutationResponseError ? error.status : null;
}

export function patientMcsLogContext(entityType: string, status?: number | null) {
  return {
    route: '/patients/:id/mcs',
    entityType,
    ...(status == null ? {} : { status }),
  };
}

export function getPatientMcsMutationFailureMessage(
  error: unknown,
  fallbackMessage: string,
  options?: { conflictMessage?: string },
): string {
  const status = getPatientMcsMutationStatus(error);
  if (status === 403) return MCS_PERMISSION_FAILURE_MESSAGE;
  if (status === 409 && options?.conflictMessage) return options.conflictMessage;
  return fallbackMessage;
}

export function getPatientMcsOverviewFailureState(error: unknown) {
  return error instanceof PatientMcsOverviewQueryError && error.code === 'forbidden'
    ? MCS_OVERVIEW_FAILURES.forbidden
    : MCS_OVERVIEW_FAILURES.failed;
}

export function isOtherProfessionalRole(role: string | null) {
  if (!role) return false;
  return !/薬剤師/.test(role);
}

export async function syncPatientMcs(patientId: string, orgId: string, sourceUrl?: string) {
  const response = await fetch(buildPatientApiPath(patientId, '/mcs-sync'), {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify(sourceUrl ? { source_url: sourceUrl } : {}),
  });

  return readPatientMcsMutationResponse(
    response,
    MCS_SYNC_FAILURE_MESSAGE,
    patientMcsSyncResponseSchema,
  );
}

export async function createPatientMcsCheckLog(
  patientId: string,
  orgId: string,
  input: PatientMcsCheckLogInput,
) {
  const response = await fetch(buildPatientApiPath(patientId, '/mcs/logs'), {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({
      content_type: input.contentType,
      summary: input.summary,
      next_action: input.nextAction.trim() || undefined,
    }),
  });

  return readPatientMcsMutationResponse(
    response,
    MCS_CHECK_LOG_FAILURE_MESSAGE,
    apiAcknowledgementSchema,
  );
}

export async function updatePatientMcsProfile(
  patientId: string,
  orgId: string,
  input: PatientMcsProfileInput,
) {
  const response = await fetch(buildPatientApiPath(patientId, '/mcs'), {
    method: 'PATCH',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({
      linked_status: input.linkedStatus,
      participation_status: input.participationStatus,
      pharmacy_participants: input.pharmacyParticipants,
      counterpart_roles: input.counterpartRoles,
      last_checked_at: input.lastCheckedAt,
      note: input.note,
    }),
  });

  return readPatientMcsMutationResponse(
    response,
    MCS_PROFILE_FAILURE_MESSAGE,
    apiAcknowledgementSchema,
  );
}

export async function copyTextToClipboard(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error('クリップボードにコピーできませんでした');
  }
  await navigator.clipboard.writeText(value);
}

export function toDateTimeLocalValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function currentDateTimeLocalValue() {
  return toDateTimeLocalValue(new Date().toISOString());
}

export function splitParticipants(value: string) {
  return value
    .split(/[\n,、]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
