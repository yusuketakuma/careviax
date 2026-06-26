import { format } from 'date-fns';
import type { EvidenceCategoryId } from '../../evidence/evidence-gallery.shared';

/**
 * p0_48「スマホで写真・証跡を撮る」の表示モデル(純関数)。
 * 種類チップは p0_33 の証跡 6 区分のサブセットへ対応づけ、生成するファイル名は
 * 同期後にサーバー側ギャラリーのファイル名射影でも同じ区分へ戻るよう設計する。
 */

export type CaptureCategoryOption = {
  /** p0_33 の証跡区分 ID(サブセット) */
  id: EvidenceCategoryId;
  label: string;
};

/**
 * 種類チップ(target の表示順)。
 * セット設置はファイル名射影(「セット」キーワード)と揃えて set_photo、
 * 説明資料は文書交付(document_delivery)へ対応づける。
 */
export const CAPTURE_CATEGORY_OPTIONS: readonly CaptureCategoryOption[] = [
  { id: 'residual_photo', label: '残薬写真' },
  { id: 'set_photo', label: 'セット設置' },
  { id: 'document_delivery', label: '説明資料' },
];

export const DEFAULT_CAPTURE_CATEGORY: EvidenceCategoryId = 'residual_photo';

/** mime → 拡張子(カメラ撮影は image/jpeg、ファイル選択は実 mime。未知は jpg) */
export function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

/**
 * 撮影ファイル名「{チップ名}_{yyyyMMdd-HHmmss}.{拡張子}」。
 * チップ名を先頭に含めることで、同期後の p0_33 ギャラリー射影
 * (projectEvidenceCategory のファイル名ルール)でも同じ区分に戻る。
 */
export function buildEvidenceDraftFileName(
  categoryId: EvidenceCategoryId,
  capturedAt: Date,
  mimeType = 'image/jpeg',
): string {
  const option = findCaptureCategoryOption(categoryId);
  return `${option.label}_${format(capturedAt, 'yyyyMMdd-HHmmss')}.${mimeTypeToExtension(mimeType)}`;
}

export type CapturePatientContext = {
  patientId: string | null;
  patientName: string | null;
  visitRecordId: string | null;
};

export type CaptureStatusSummary = {
  categoryLabel: string;
  patientLabel: string;
  savedDraftLabel: string;
  description: string;
};

export function findCaptureCategoryOption(categoryId: EvidenceCategoryId): CaptureCategoryOption {
  return (
    CAPTURE_CATEGORY_OPTIONS.find((candidate) => candidate.id === categoryId) ??
    CAPTURE_CATEGORY_OPTIONS[0]
  );
}

export function buildCaptureStatusSummary({
  categoryId,
  patientName,
  savedCount,
}: {
  categoryId: EvidenceCategoryId;
  patientName?: string | null;
  savedCount: number;
}): CaptureStatusSummary {
  const categoryLabel = findCaptureCategoryOption(categoryId).label;

  return {
    categoryLabel,
    patientLabel: patientName ? `${patientName} 様` : '患者未確定',
    savedDraftLabel: savedCount > 0 ? `この訪問で端末保存 ${savedCount}枚` : '撮影前',
    description: `${categoryLabel}として端末に保存し、画像・証跡では未同期として確認できます。`,
  };
}

/**
 * 訪問予定詳細 API レスポンスから患者表示名・患者 ID・紐づく訪問記録 ID を
 * 安全に取り出す(/visits/[id]/brief と同じく訪問予定を一次情報にする)。
 */
export function resolveCapturePatientContext(payload: unknown): CapturePatientContext {
  const empty: CapturePatientContext = {
    patientId: null,
    patientName: null,
    visitRecordId: null,
  };
  if (typeof payload !== 'object' || payload === null) return empty;

  const source = payload as {
    patient_id?: unknown;
    case_?: { patient?: { name?: unknown } | null } | null;
    visit_record?: { id?: unknown } | null;
  };

  const patientId =
    typeof source.patient_id === 'string' && source.patient_id ? source.patient_id : null;

  const rawName = source.case_?.patient?.name;
  const patientName = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;

  const rawRecordId = source.visit_record?.id;
  const visitRecordId = typeof rawRecordId === 'string' && rawRecordId ? rawRecordId : null;

  return { patientId, patientName, visitRecordId };
}
