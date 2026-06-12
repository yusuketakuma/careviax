import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CATEGORIES,
  buildEvidenceItemsFromOfflineDrafts,
  buildEvidenceItemsFromVisitRecords,
  filterEvidenceItemsByCategory,
  formatCaptureTime,
  mergeEvidenceItems,
  projectEvidenceCategory,
  sortEvidenceItems,
  type EvidenceGalleryItem,
} from './evidence-gallery.shared';
import { buildEvidenceDemoItems } from './evidence-gallery.demo';

/** ローカルタイムで ISO を作る(タイムゾーン非依存のテストにする) */
function localIso(hour: number, minute: number): string {
  return new Date(2026, 5, 13, hour, minute, 0).toISOString();
}

function buildItem(overrides: Partial<EvidenceGalleryItem> = {}): EvidenceGalleryItem {
  return {
    id: 'item-1',
    category: 'residual_photo',
    syncState: 'synced',
    capturedAt: localIso(10, 0),
    fileName: '残薬写真_01.jpg',
    ...overrides,
  };
}

describe('EVIDENCE_CATEGORIES', () => {
  it('target の 6 区分を target と同じ順序で持つ', () => {
    expect(EVIDENCE_CATEGORIES.map((category) => category.label)).toEqual([
      '残薬写真',
      'セット写真',
      '設置写真',
      '文書交付',
      '報告書控え',
      '同意書',
    ]);
  });
});

describe('projectEvidenceCategory', () => {
  it('明示された区分 ID を最優先で採用する', () => {
    expect(
      projectEvidenceCategory({
        explicitCategory: 'consent_document',
        fileName: '残薬写真.jpg',
        kind: 'photo',
      }),
    ).toBe('consent_document');
  });

  it('未知の明示区分は無視して通常の射影に落ちる', () => {
    expect(projectEvidenceCategory({ explicitCategory: 'unknown_category', kind: 'photo' })).toBe(
      'residual_photo',
    );
  });

  it('purpose=report は報告書控えに射影する', () => {
    expect(projectEvidenceCategory({ purpose: 'report', fileName: 'visit-summary.pdf' })).toBe(
      'report_copy',
    );
  });

  it.each([
    ['同意書_在宅訪問.pdf', 'consent_document'],
    ['残薬写真_01.jpg', 'residual_photo'],
    ['服薬カレンダーセット.jpg', 'set_photo'],
    ['設置写真_玄関.jpg', 'placement_photo'],
    ['報告書控え_主治医宛.pdf', 'report_copy'],
    ['文書交付_薬剤情報提供書.pdf', 'document_delivery'],
  ] as const)('ファイル名「%s」を %s に射影する', (fileName, expected) => {
    expect(projectEvidenceCategory({ purpose: 'visit-photo', kind: 'photo', fileName })).toBe(
      expected,
    );
  });

  it('キーワードの無い文書添付(kind=attachment)は文書交付に射影する', () => {
    expect(
      projectEvidenceCategory({
        purpose: 'visit-photo',
        kind: 'attachment',
        fileName: 'scan_20260613.pdf',
      }),
    ).toBe('document_delivery');
  });

  it('キーワードの無い写真は既定の残薬写真に射影する', () => {
    expect(
      projectEvidenceCategory({ purpose: 'visit-photo', kind: 'photo', fileName: 'IMG_0012.jpg' }),
    ).toBe('residual_photo');
  });
});

describe('buildEvidenceItemsFromVisitRecords', () => {
  it('添付を同期済みアイテムへ変換し、uploaded_at が無ければ記録の created_at を使う', () => {
    const items = buildEvidenceItemsFromVisitRecords([
      {
        id: 'record-1',
        created_at: localIso(9, 30),
        attachments: [
          {
            file_id: 'file-1',
            file_name: '残薬写真_01.jpg',
            uploaded_at: localIso(10, 0),
            kind: 'photo',
          },
          {
            file_id: 'file-2',
            file_name: 'scan_20260613.pdf',
            uploaded_at: null,
            kind: 'attachment',
          },
        ],
      },
      { id: 'record-2', created_at: localIso(8, 0), attachments: null },
    ]);

    expect(items).toEqual([
      {
        id: 'file-2',
        category: 'document_delivery',
        syncState: 'synced',
        capturedAt: localIso(9, 30),
        fileName: 'scan_20260613.pdf',
      },
      {
        id: 'file-1',
        category: 'residual_photo',
        syncState: 'synced',
        capturedAt: localIso(10, 0),
        fileName: '残薬写真_01.jpg',
      },
    ]);
  });
});

describe('sortEvidenceItems', () => {
  it('撮影時刻の昇順に並べ、不明(null/不正値)は末尾に置く', () => {
    const sorted = sortEvidenceItems([
      buildItem({ id: 'b', capturedAt: localIso(10, 5) }),
      buildItem({ id: 'unknown', capturedAt: null }),
      buildItem({ id: 'broken', capturedAt: 'not-a-date' }),
      buildItem({ id: 'a', capturedAt: localIso(10, 0) }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['a', 'b', 'unknown', 'broken']);
  });
});

describe('filterEvidenceItemsByCategory', () => {
  it('選択区分のアイテムのみ返す', () => {
    const items = [
      buildItem({ id: 'r-1', category: 'residual_photo' }),
      buildItem({ id: 's-1', category: 'set_photo' }),
      buildItem({ id: 'r-2', category: 'residual_photo' }),
    ];

    expect(filterEvidenceItemsByCategory(items, 'residual_photo').map((item) => item.id)).toEqual([
      'r-1',
      'r-2',
    ]);
    expect(filterEvidenceItemsByCategory(items, 'consent_document')).toEqual([]);
  });
});

describe('formatCaptureTime', () => {
  it('ローカル時刻の HH:mm を返す', () => {
    expect(formatCaptureTime(localIso(10, 5))).toBe('10:05');
  });

  it('null や parse 不能な値は null を返す', () => {
    expect(formatCaptureTime(null)).toBeNull();
    expect(formatCaptureTime('not-a-date')).toBeNull();
  });
});

describe('buildEvidenceDemoItems', () => {
  it('残薬写真は target と同じ 8 枚(未同期 3 / 同期済み 5、撮影 10:00〜10:07)', () => {
    const residual = filterEvidenceItemsByCategory(buildEvidenceDemoItems(), 'residual_photo');

    expect(residual).toHaveLength(8);
    expect(residual.filter((item) => item.syncState === 'pending')).toHaveLength(3);
    expect(residual.filter((item) => item.syncState === 'synced')).toHaveLength(5);
    expect(residual.map((item) => formatCaptureTime(item.capturedAt))).toEqual([
      '10:00',
      '10:01',
      '10:02',
      '10:03',
      '10:04',
      '10:05',
      '10:06',
      '10:07',
    ]);
  });

  it('6 区分すべてに 1 枚以上入っている', () => {
    const items = buildEvidenceDemoItems();
    for (const category of EVIDENCE_CATEGORIES) {
      expect(filterEvidenceItemsByCategory(items, category.id).length).toBeGreaterThan(0);
    }
  });

  it('ファイル名は自身の区分に射影される(語彙とデモの整合)', () => {
    for (const item of buildEvidenceDemoItems()) {
      expect(projectEvidenceCategory({ kind: 'photo', fileName: item.fileName })).toBe(
        item.category,
      );
    }
  });
});

describe('buildEvidenceItemsFromOfflineDrafts', () => {
  it('p0_48 のオフラインドラフトを「未同期」アイテムへ変換する(明示区分が最優先)', () => {
    const items = buildEvidenceItemsFromOfflineDrafts([
      {
        id: 12,
        category: 'set_photo',
        fileName: 'セット設置_20260613-103045.jpg',
        capturedAt: localIso(10, 30),
      },
    ]);

    expect(items).toEqual([
      {
        id: 'offline-draft-12',
        category: 'set_photo',
        syncState: 'pending',
        capturedAt: localIso(10, 30),
        fileName: 'セット設置_20260613-103045.jpg',
      },
    ]);
  });

  it('区分が欠けたドラフトはファイル名から射影する(説明資料 → 文書交付)', () => {
    const [item] = buildEvidenceItemsFromOfflineDrafts([
      { id: null, fileName: '説明資料_20260613-103045.jpg', capturedAt: localIso(10, 31) },
    ]);

    expect(item.category).toBe('document_delivery');
    expect(item.syncState).toBe('pending');
    expect(item.id).toBe('offline-draft-0');
  });
});

describe('mergeEvidenceItems', () => {
  it('サーバー保存済みと端末ドラフトを撮影時刻の昇順で統合する', () => {
    const serverItems = [
      buildItem({ id: 'server-1', capturedAt: localIso(10, 0) }),
      buildItem({ id: 'server-2', capturedAt: localIso(10, 4) }),
    ];
    const draftItems = buildEvidenceItemsFromOfflineDrafts([
      { id: 1, category: 'residual_photo', fileName: '残薬写真_a.jpg', capturedAt: localIso(10, 2) },
    ]);

    expect(mergeEvidenceItems(serverItems, draftItems).map((item) => item.id)).toEqual([
      'server-1',
      'offline-draft-1',
      'server-2',
    ]);
  });
});
