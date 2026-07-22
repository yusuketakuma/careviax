import { readApiJson, type ApiJsonSchema } from '@/lib/api/client-json';
import { isPatientArchivedWriteConflictPayload } from '@/lib/patient/archive-summary';
import {
  buildNextCheckTaskInput,
  buildShareCommunicationRequestInput,
  type ShareAudienceKey,
} from './interprofessional-share.helpers';

export const FOLLOWUP_TASK_FAILURE_MESSAGE =
  '次回タスクの作成に失敗しました。もう一度お試しください。';
export const FOLLOWUP_TASK_CONFLICT_MESSAGE =
  '次回タスクは既に作成されている可能性があります。タスク一覧を確認してください。';
export const FOLLOWUP_TASK_PERMISSION_MESSAGE = '運用タスクの作成権限がありません。';
export const FOLLOWUP_TASK_DESCRIPTION_ID = 'followup-task-description';
export const REPLY_REQUEST_FAILURE_MESSAGE =
  '返信依頼の起票に失敗しました。もう一度お試しください。';
export const REPLY_REQUEST_CONFLICT_MESSAGE =
  '返信依頼は既に起票されている可能性があります。連携依頼の状態を確認しています。';

export type FollowupTaskMutationInput = {
  audience: ShareAudienceKey;
  responseId: string;
  payload: ReturnType<typeof buildNextCheckTaskInput>;
};

export type ReplyRequestMutationInput = {
  audience: ShareAudienceKey;
  payload: ReturnType<typeof buildShareCommunicationRequestInput>;
};

export class ShareMutationResponseError extends Error {
  constructor(
    readonly status: number,
    fallbackMessage: string,
    readonly kind: 'patient_archived' | null = null,
  ) {
    super(fallbackMessage);
    this.name = 'ShareMutationResponseError';
  }
}

export async function readShareMutationResponse<T>(
  response: Response,
  fallbackMessage: string,
  schema?: ApiJsonSchema<T>,
): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ShareMutationResponseError(
      response.status,
      fallbackMessage,
      response.status === 409 && isPatientArchivedWriteConflictPayload(payload)
        ? 'patient_archived'
        : null,
    );
  }
  return readApiJson<T>(response, { fallbackMessage, schema });
}

export function getShareMutationResponseStatus(error: unknown): number | null {
  return error instanceof ShareMutationResponseError ? error.status : null;
}

export function shouldReconcileFollowupTaskPermission(error: unknown): boolean {
  const status = getShareMutationResponseStatus(error);
  return status !== null && [400, 401, 403, 404].includes(status);
}

export function isPatientArchivedWriteError(error: unknown): error is ShareMutationResponseError {
  return error instanceof ShareMutationResponseError && error.kind === 'patient_archived';
}

export function isDuplicateShareMutationConflict(error: unknown): boolean {
  return getShareMutationResponseStatus(error) === 409 && !isPatientArchivedWriteError(error);
}
