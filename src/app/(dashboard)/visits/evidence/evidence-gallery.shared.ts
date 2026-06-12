import { format } from 'date-fns';

/**
 * p0_33「画像・証跡」の表示モデル(純関数)。
 * 既存語彙(FileAsset.purpose / 訪問記録添付の kind / ファイル名)には
 * 表示用 6 区分(証跡の種類)への完全な対応が無いため、ここで射影する。
 */

export const EVIDENCE_CATEGORIES = [
  { id: 'residual_photo', label: '残薬写真' },
  { id: 'set_photo', label: 'セット写真' },
  { id: 'placement_photo', label: '設置写真' },
  { id: 'document_delivery', label: '文書交付' },
  { id: 'report_copy', label: '報告書控え' },
  { id: 'consent_document', label: '同意書' },
] as const;

export type EvidenceCategoryId = (typeof EVIDENCE_CATEGORIES)[number]['id'];

/** pending=端末上のみ(未同期=橙) / synced=サーバー保存済み(同期済み=緑) */
export type EvidenceSyncState = 'pending' | 'synced';

export type EvidenceGalleryItem = {
  id: string;
  category: EvidenceCategoryId;
  syncState: EvidenceSyncState;
  /** 撮影(=アップロード/作成)時刻の ISO 文字列。不明なら null */
  capturedAt: string | null;
  fileName: string | null;
};

const CATEGORY_ID_SET = new Set<string>(EVIDENCE_CATEGORIES.map((category) => category.id));

export type EvidenceCategorySource = {
  /** FileAsset.purpose('visit-photo' | 'report' | 'prescription') */
  purpose?: string | null;
  /** 訪問記録添付の kind('photo' | 'attachment') */
  kind?: string | null;
  fileName?: string | null;
  /** メタデータ等で明示された区分 ID(あれば最優先) */
  explicitCategory?: string | null;
};

/** ファイル名キーワード → 区分(上から順に評価) */
const FILE_NAME_RULES: ReadonlyArray<{ keywords: readonly string[]; category: EvidenceCategoryId }> =
  [
    { keywords: ['同意'], category: 'consent_document' },
    { keywords: ['残薬'], category: 'residual_photo' },
    { keywords: ['セット', 'カレンダー'], category: 'set_photo' },
    { keywords: ['設置'], category: 'placement_photo' },
    { keywords: ['報告書', '控え'], category: 'report_copy' },
    { keywords: ['交付', '文書', '説明書'], category: 'document_delivery' },
  ];

/**
 * 既存の purpose / kind / ファイル名から表示用 6 区分へ射影する。
 * 1. 明示区分(metadata 等) 2. purpose=report → 報告書控え
 * 3. ファイル名キーワード 4. 文書添付 → 文書交付 5. 既定 → 残薬写真
 * (訪問写真の最頻区分が残薬写真のため、判別不能な写真は残薬写真に寄せる)
 */
export function projectEvidenceCategory(source: EvidenceCategorySource): EvidenceCategoryId {
  if (source.explicitCategory && CATEGORY_ID_SET.has(source.explicitCategory)) {
    return source.explicitCategory as EvidenceCategoryId;
  }

  if (source.purpose === 'report') return 'report_copy';

  const fileName = source.fileName ?? '';
  for (const rule of FILE_NAME_RULES) {
    if (rule.keywords.some((keyword) => fileName.includes(keyword))) {
      return rule.category;
    }
  }

  if (source.kind === 'attachment') return 'document_delivery';
  return 'residual_photo';
}

/** /api/visit-records/[id] が返す添付(画面で使う部分のみ) */
export type VisitRecordAttachmentSummary = {
  file_id: string;
  file_name: string;
  uploaded_at: string | null;
  kind: 'photo' | 'attachment';
};

export type VisitRecordDetailForEvidence = {
  id: string;
  created_at?: string | null;
  attachments?: VisitRecordAttachmentSummary[] | null;
};

/** 撮影時刻の昇順(target の 撮影 10:00→10:07 並び)。不明は末尾 */
export function sortEvidenceItems(items: EvidenceGalleryItem[]): EvidenceGalleryItem[] {
  const sortKey = (item: EvidenceGalleryItem): number => {
    if (!item.capturedAt) return Number.POSITIVE_INFINITY;
    const time = Date.parse(item.capturedAt);
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
  };
  return [...items].sort((a, b) => sortKey(a) - sortKey(b));
}

/** 訪問記録詳細の添付を「サーバー保存済み(=同期済み)」の証跡アイテムへ変換する。 */
export function buildEvidenceItemsFromVisitRecords(
  records: VisitRecordDetailForEvidence[],
): EvidenceGalleryItem[] {
  const items = records.flatMap((record) =>
    (record.attachments ?? []).map((attachment): EvidenceGalleryItem => {
      return {
        id: attachment.file_id,
        category: projectEvidenceCategory({
          purpose: 'visit-photo',
          kind: attachment.kind,
          fileName: attachment.file_name,
        }),
        syncState: 'synced',
        capturedAt: attachment.uploaded_at ?? record.created_at ?? null,
        fileName: attachment.file_name,
      };
    }),
  );
  return sortEvidenceItems(items);
}

export function filterEvidenceItemsByCategory(
  items: EvidenceGalleryItem[],
  category: EvidenceCategoryId,
): EvidenceGalleryItem[] {
  return items.filter((item) => item.category === category);
}

/** 「撮影 HH:MM」表示用の時刻。parse 不能な値は null */
export function formatCaptureTime(capturedAt: string | null): string | null {
  if (!capturedAt) return null;
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'HH:mm');
}
