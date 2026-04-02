import { describe, expect, it } from 'vitest';
import { describePatientMcsStatus, describePatientMcsSyncResult } from './status';

describe('describePatientMcsStatus', () => {
  it('treats missing URLs as disconnected', () => {
    expect(describePatientMcsStatus(null)).toMatchObject({
      label: '未接続',
      variant: 'outline',
    });
  });

  it('surfaces sync failures first', () => {
    expect(
      describePatientMcsStatus({
        sourceUrl: 'https://www.medical-care.net/patients/2463520',
        projectUrl: null,
        lastSyncStatus: 'failed',
        lastSyncedAt: null,
        lastSyncError: '認証エラー',
      })
    ).toMatchObject({
      label: '同期エラー',
      variant: 'destructive',
      description: '認証エラー',
    });
  });

  it('distinguishes saved-but-not-synced links from successful syncs', () => {
    expect(
      describePatientMcsStatus({
        sourceUrl: 'https://www.medical-care.net/patients/2463520',
        projectUrl: null,
        lastSyncStatus: null,
        lastSyncedAt: null,
        lastSyncError: null,
      })
    ).toMatchObject({
      label: '接続準備完了',
    });

    expect(
      describePatientMcsStatus({
        sourceUrl: 'https://www.medical-care.net/patients/2463520',
        projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
        lastSyncStatus: 'success',
        lastSyncedAt: '2026-04-02T08:00:00.000Z',
        lastSyncError: null,
      })
    ).toMatchObject({
      label: '同期済み',
      variant: 'secondary',
    });
  });
});

describe('describePatientMcsSyncResult', () => {
  it('mentions fallback generation when no other-professional posts were found', () => {
    expect(
      describePatientMcsSyncResult({
        importedCount: 1,
        projectTitle: '青葉 花子：年長者の里',
        summary: {
          isFallback: true,
          otherProfessionalMessageCount: 0,
        },
      })
    ).toBe('「青葉 花子：年長者の里」を同期しました。他職種投稿は未検出のため要約はルール生成です。');
  });

  it('mentions AI refresh when an AI summary was updated', () => {
    expect(
      describePatientMcsSyncResult({
        importedCount: 4,
        projectTitle: '青葉 花子：年長者の里',
        summary: {
          isFallback: false,
          otherProfessionalMessageCount: 3,
        },
      })
    ).toBe('「青葉 花子：年長者の里」から 4 件同期しました。AI要約を更新しました。');
  });
});
