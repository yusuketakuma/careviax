import { describe, expect, it } from 'vitest';
import { buildPatientMcsSyncToastMessage } from './sync-feedback';

describe('buildPatientMcsSyncToastMessage', () => {
  it('includes the summary headline when available', () => {
    expect(
      buildPatientMcsSyncToastMessage(
        {
          importedCount: 3,
          latestMessageAt: '2026-04-02T08:00:00.000Z',
          projectTitle: '青葉 花子：年長者の里',
          summary: {
            id: 'summary_1',
            generationId: 'gen_1',
            provider: 'rule',
            requestedProvider: 'disabled',
            isFallback: true,
            model: null,
            fallbackReason: 'provider_unavailable',
            headline: '看護師から折返し依頼があります。',
            bullets: [],
            mustCheckToday: [],
            suggestedActions: [],
            sourceRefs: [],
            messageCount: 3,
            otherProfessionalMessageCount: 2,
            latestPostedAt: null,
            generatedAt: '2026-04-02T08:05:00.000Z',
            durationMs: null,
          },
        },
        '「青葉 花子：年長者の里」'
      )
    ).toBe('「青葉 花子：年長者の里」から 3 件同期しました。看護師から折返し依頼があります。');
  });

  it('falls back to the count-only toast when summary is absent', () => {
    expect(
      buildPatientMcsSyncToastMessage(
        {
          importedCount: 0,
          latestMessageAt: null,
          projectTitle: null,
          summary: null,
        },
        'MCS 連携'
      )
    ).toBe('MCS 連携を同期しました');
  });
});
