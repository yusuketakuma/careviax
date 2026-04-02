import { describe, expect, it } from 'vitest';
import {
  canOpenPatientMcsPage,
  describePatientMcsCardStatus,
  parsePatientMcsCardViewData,
  restrictedPatientMcsCardViewData,
} from './card';

describe('patient-mcs card dto', () => {
  it('extracts the normalized link for the patient detail card', () => {
    const parsed = parsePatientMcsCardViewData({
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
          provider: 'rule',
          requested_provider: 'disabled',
          is_fallback: true,
          model: null,
          fallback_reason: 'provider_unavailable',
          headline: '看護師から共有があります。',
          bullets: ['食欲低下が継続しています。'],
          must_check_today: ['次回訪問時に食事量を確認してください。'],
          suggested_actions: ['ケアマネへ折返し連絡してください。'],
          source_refs: ['4/2 12:12 看護師 篠原 陽子'],
          message_count: 4,
          other_professional_message_count: 3,
          latest_posted_at: '2026-04-02T08:00:00.000Z',
          generated_at: '2026-04-02T08:05:00.000Z',
          duration_ms: null,
        },
        messages: [],
      },
    });

    expect(parsed).toMatchObject({
      isRestricted: false,
      link: {
        sourceUrl: 'https://www.medical-care.net/patients/2463520',
        projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
      },
      summary: {
        provider: 'rule',
        headline: '看護師から共有があります。',
      },
    });
  });

  it('builds a restricted placeholder state', () => {
    expect(restrictedPatientMcsCardViewData()).toEqual({
      link: null,
      summary: null,
      isRestricted: true,
      isError: false,
    });
  });

  it('suppresses the detail CTA for restricted users', () => {
    expect(canOpenPatientMcsPage(undefined)).toBe(false);
    expect(canOpenPatientMcsPage(restrictedPatientMcsCardViewData())).toBe(false);
    expect(
      canOpenPatientMcsPage({
        link: null,
        summary: null,
        isRestricted: false,
        isError: true,
      })
    ).toBe(false);
    expect(
      canOpenPatientMcsPage({
        link: null,
        summary: null,
        isRestricted: false,
        isError: false,
      })
    ).toBe(true);
  });

  it('returns a dedicated error state when card retrieval fails', () => {
    expect(
      describePatientMcsCardStatus({
        link: null,
        isRestricted: false,
        isError: true,
      })
    ).toMatchObject({
      label: '取得エラー',
      variant: 'destructive',
    });
  });
});
