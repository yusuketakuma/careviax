import { describe, expect, it } from 'vitest';
import { parsePatientMcsSyncResult, parsePatientMcsViewData } from './dto';

describe('patient-mcs dto', () => {
  it('normalizes the saved MCS overview payload', () => {
    const parsed = parsePatientMcsViewData({
      data: {
        patient: { id: 'patient_1', name: '青葉 花子' },
        link: {
          id: 'link_1',
          source_url: 'https://www.medical-care.net/patients/2463520',
          mcs_patient_id: '2463520',
          mcs_patient_url: 'https://www.medical-care.net/patients/2463520',
          mcs_project_id: '57886227',
          mcs_project_url: 'https://www.medical-care.net/projects/medical/57886227',
          project_title: '青葉 花子：年長者の里',
          project_memo: '年長者の里',
          member_count: 9,
          last_sync_attempt_at: '2026-04-02T08:00:00.000Z',
          last_synced_at: '2026-04-02T08:00:00.000Z',
          last_sync_status: 'success',
          last_sync_error: null,
        },
        summary: {
          id: 'summary_1',
          generation_id: 'gen_1',
          provider: 'openai',
          requested_provider: 'openai',
          is_fallback: false,
          model: 'gpt-5-mini',
          fallback_reason: null,
          headline: '看護師とケアマネから状態共有があります。',
          bullets: ['食欲低下が継続しています。'],
          must_check_today: ['次回訪問時に食事量を確認してください。'],
          suggested_actions: ['ケアマネへ折返し連絡してください。'],
          source_refs: ['4/2 12:12 看護師 篠原 陽子'],
          message_count: 4,
          other_professional_message_count: 3,
          latest_posted_at: '2026-04-02T08:00:00.000Z',
          generated_at: '2026-04-02T08:05:00.000Z',
          duration_ms: 820,
        },
        messages: [],
      },
    });

    expect(parsed.link).toMatchObject({
      sourceUrl: 'https://www.medical-care.net/patients/2463520',
      projectId: '57886227',
      projectTitle: '青葉 花子：年長者の里',
    });
    expect(parsed.summary).toMatchObject({
      provider: 'openai',
      headline: '看護師とケアマネから状態共有があります。',
      mustCheckToday: ['次回訪問時に食事量を確認してください。'],
      suggestedActions: ['ケアマネへ折返し連絡してください。'],
    });
  });

  it('normalizes the sync result payload with project metadata', () => {
    const parsed = parsePatientMcsSyncResult({
      data: {
        importedCount: 4,
        latestMessageAt: '2026-04-02T08:00:00.000Z',
        link: {
          project_title: '青葉 花子：年長者の里',
        },
        summary: {
          id: 'summary_1',
          generation_id: 'gen_1',
          provider: 'rule',
          requested_provider: 'disabled',
          is_fallback: true,
          model: null,
          fallback_reason: 'provider_unavailable',
          headline: '看護師から共有があります。',
          bullets: ['食欲低下が継続しています。'],
          must_check_today: ['次回訪問時に食事量を確認してください。'],
          suggested_actions: ['水分摂取量を再確認してください。'],
          source_refs: ['4/2 12:12 看護師 篠原 陽子'],
          message_count: 4,
          other_professional_message_count: 3,
          latest_posted_at: '2026-04-02T08:00:00.000Z',
          generated_at: '2026-04-02T08:05:00.000Z',
          duration_ms: null,
        },
      },
    });

    expect(parsed).toEqual({
      importedCount: 4,
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
        headline: '看護師から共有があります。',
        bullets: ['食欲低下が継続しています。'],
        mustCheckToday: ['次回訪問時に食事量を確認してください。'],
        suggestedActions: ['水分摂取量を再確認してください。'],
        sourceRefs: ['4/2 12:12 看護師 篠原 陽子'],
        messageCount: 4,
        otherProfessionalMessageCount: 3,
        latestPostedAt: '2026-04-02T08:00:00.000Z',
        generatedAt: '2026-04-02T08:05:00.000Z',
        durationMs: null,
      },
    });
  });

  it('defaults missing summary arrays to empty lists', () => {
    const parsed = parsePatientMcsViewData({
      data: {
        patient: { id: 'patient_1', name: '青葉 花子' },
        link: null,
        summary: {
          id: 'summary_1',
          generation_id: 'gen_1',
          provider: 'rule',
          requested_provider: 'disabled',
          is_fallback: true,
          model: null,
          fallback_reason: null,
          headline: '共有はありません。',
          bullets: undefined as unknown as string[],
          must_check_today: undefined as unknown as string[],
          suggested_actions: undefined as unknown as string[],
          source_refs: undefined as unknown as string[],
          message_count: 0,
          other_professional_message_count: 0,
          latest_posted_at: null,
          generated_at: '2026-04-02T08:05:00.000Z',
          duration_ms: null,
        },
        messages: [],
      },
    });

    expect(parsed.summary).toMatchObject({
      bullets: [],
      mustCheckToday: [],
      suggestedActions: [],
      sourceRefs: [],
    });
  });
});
