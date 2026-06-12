import type { EvidenceGalleryItem } from './evidence-gallery.shared';

/**
 * p0_33 撮影・動作確認用のデモデータ(dev 限定で window フックから注入)。
 * 残薬写真タブは target と同じ 8 枚(未同期 3 / 同期済み 5、撮影 10:00〜10:07)。
 * 他 5 区分にも 1 枚ずつ入れてタブ切替の動作確認をできるようにする。
 */

/** ローカルタイムで構築し「撮影 HH:MM」表示とタイムゾーン非依存で一致させる */
function demoCaptureTime(hour: number, minute: number): string {
  return new Date(2026, 5, 13, hour, minute, 0).toISOString();
}

/** target の並び: 未同期/同期済み/同期済み/未同期/同期済み/同期済み/未同期/同期済み */
const RESIDUAL_SYNC_STATES = [
  'pending',
  'synced',
  'synced',
  'pending',
  'synced',
  'synced',
  'pending',
  'synced',
] as const;

export function buildEvidenceDemoItems(): EvidenceGalleryItem[] {
  const residualItems = RESIDUAL_SYNC_STATES.map(
    (syncState, index): EvidenceGalleryItem => ({
      id: `demo-evidence-residual-${index + 1}`,
      category: 'residual_photo',
      syncState,
      capturedAt: demoCaptureTime(10, index),
      fileName: `残薬写真_${String(index + 1).padStart(2, '0')}.jpg`,
    }),
  );

  const otherItems: EvidenceGalleryItem[] = [
    {
      id: 'demo-evidence-set-1',
      category: 'set_photo',
      syncState: 'synced',
      capturedAt: demoCaptureTime(10, 10),
      fileName: 'セット写真_服薬カレンダー.jpg',
    },
    {
      id: 'demo-evidence-placement-1',
      category: 'placement_photo',
      syncState: 'pending',
      capturedAt: demoCaptureTime(10, 12),
      fileName: '設置写真_玄関収納.jpg',
    },
    {
      id: 'demo-evidence-document-1',
      category: 'document_delivery',
      syncState: 'synced',
      capturedAt: demoCaptureTime(10, 15),
      fileName: '文書交付_薬剤情報提供書.pdf',
    },
    {
      id: 'demo-evidence-report-1',
      category: 'report_copy',
      syncState: 'synced',
      capturedAt: demoCaptureTime(10, 20),
      fileName: '報告書控え_主治医宛.pdf',
    },
    {
      id: 'demo-evidence-consent-1',
      category: 'consent_document',
      syncState: 'synced',
      capturedAt: demoCaptureTime(10, 25),
      fileName: '同意書_在宅訪問管理.pdf',
    },
  ];

  return [...residualItems, ...otherItems];
}
