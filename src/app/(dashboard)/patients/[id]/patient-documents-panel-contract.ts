import { z } from 'zod';
import { apiDataSchema } from '@/lib/api/response-schemas';

// Validate the minimal mutation success envelope so raw document rows never reach the client.
export const firstVisitDocumentMutationResponseSchema = apiDataSchema(
  z.object({ id: z.string(), updated_at: z.string().datetime() }),
);

export class FirstVisitDocumentVersionConflictError extends Error {}

const FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_REASON = 'first_visit_document_version_conflict';
const ARCHIVED_PATIENT_CONFLICT_MESSAGE = 'アーカイブ中の患者は復元するまで更新できません';
const PRINT_READINESS_CONFLICT_PREFIX = '初回文書の印刷前チェックで必須項目が未完了です。';
const PRINT_READINESS_RECOVERY_MESSAGE =
  '初回文書の印刷前チェックが未完了です。患者文書画面で必須項目を確認してください。';
const FIRST_VISIT_DOCUMENT_MUTATION_RECOVERY_MESSAGE =
  '初回訪問文書を更新できませんでした。再読み込みしてから操作してください。';

export async function isFirstVisitDocumentVersionConflict(response: Response) {
  if (response.status !== 409) return false;
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  if (typeof body !== 'object' || body === null || !('details' in body)) return false;
  const details = body.details;
  return (
    typeof details === 'object' &&
    details !== null &&
    'reason' in details &&
    details.reason === FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_REASON
  );
}

export async function fixedFirstVisitDocumentMutationError(response: Response) {
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  const message =
    typeof body === 'object' && body !== null && 'message' in body ? body.message : null;
  if (message === ARCHIVED_PATIENT_CONFLICT_MESSAGE) return ARCHIVED_PATIENT_CONFLICT_MESSAGE;
  if (typeof message === 'string' && message.startsWith(PRINT_READINESS_CONFLICT_PREFIX)) {
    return PRINT_READINESS_RECOVERY_MESSAGE;
  }
  return FIRST_VISIT_DOCUMENT_MUTATION_RECOVERY_MESSAGE;
}

export const DOCUMENT_ACTION_LABELS: Record<string, string> = {
  generated: '作成',
  printed: '印刷',
  recovered: '回収',
  image_saved: '画像保存',
  replaced: '差替え',
  invalidated: '無効化',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  contract: '契約書',
  important_matters: '重要事項説明書',
  consent: '同意書',
  privacy_consent: '個人情報同意書',
  first_visit_document: '初回訪問文書',
  other: 'その他',
};

export const FIRST_VISIT_DOCUMENT_SAVE_BLOCKER_ID_PREFIX = 'first-visit-document-save-blocker';

export function getFirstVisitDocumentSaveBlocker(args: {
  missingRequiredDocumentUrl: boolean;
  missingRequiredDeliveryTarget: boolean;
  missingRequiredReason: boolean;
}): string | null {
  const missingFields: string[] = [];
  if (args.missingRequiredDocumentUrl) missingFields.push('文書URL');
  if (args.missingRequiredDeliveryTarget) missingFields.push('交付先');
  if (args.missingRequiredReason) missingFields.push('理由');

  if (missingFields.length === 0) return null;
  return `保存するには、${missingFields.join('、')}を入力してください。`;
}

export const DOCUMENT_STORAGE_LABELS: Record<string, string> = {
  store: '店舗',
  headquarters: '本部',
  patient_home_copy_only: '患者宅控えのみ',
  electronic: '電子保管',
  unknown: '未確認',
};

export const SIGNER_TYPE_LABELS: Record<string, string> = {
  self: '本人',
  family: '家族',
  proxy: '代理人',
  guardian: '後見人',
  other: 'その他',
};
