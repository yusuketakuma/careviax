// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { VisitBrief } from '@/types/visit-brief';
import { VisitBriefCard } from './visit-brief-card';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn(() => 'org_1'));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

function buildBrief(): VisitBrief {
  return {
    patient: {
      id: 'patient_1',
      name: '患者A',
    },
    context: 'patient',
    generated_at: '2026-04-09T00:00:00.000Z',
    last_prescribed_date: '2026-04-08T00:00:00.000Z',
    baseline_context: null,
    medication_changes: [],
    patient_changes: [],
    medications: [],
    dispensing_items: [],
    delivery_status: [],
    dosage_form_support: [],
    multidisciplinary_updates: [],
    jahis_supplemental_records: [],
    unresolved_items: [],
    must_check_today: [],
    rule_summary: {
      generation_id: 'rule_1',
      headline: 'ルール要約',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-04-09T00:00:00.000Z',
    },
    ai_summary: {
      generation_id: 'ai_1',
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: 'provider_unavailable',
      headline: 'AI要約',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-04-09T00:00:00.000Z',
      duration_ms: null,
      recent_failure_rate_24h: null,
      recent_failure_count_24h: 0,
      recent_generation_count_24h: 0,
    },
    conference_summary: {
      recent_conferences: 2,
      pending_action_items: 1,
      last_conference_date: '2026-04-08T10:00:00.000Z',
      last_conference_type: '退院前カンファレンス',
      summary: '退院後初回訪問。持参薬の確認と生活指導が優先。',
      highlighted_risks: ['服薬アドヒアランス低下', '転倒リスク'],
    },
    facility_context: null,
    drug_cautions: [],
  };
}

describe('VisitBriefCard', () => {
  it('renders conference summary and highlighted risks when available', () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <VisitBriefCard brief={buildBrief()} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('退院前カンファレンス')).toBeTruthy();
    expect(screen.getByText('退院後初回訪問。持参薬の確認と生活指導が優先。')).toBeTruthy();
    expect(screen.getByText('服薬アドヒアランス低下')).toBeTruthy();
    expect(screen.getByText('転倒リスク')).toBeTruthy();
  });

  it('renders the empty state when there are no patient changes', () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <VisitBriefCard brief={buildBrief()} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('前回訪問以降の患者情報変更はありません。')).toBeTruthy();
  });

  it('renders patient changes with a change-type badge and previous→current detail', () => {
    const queryClient = new QueryClient();
    const brief: VisitBrief = {
      ...buildBrief(),
      patient_changes: [
        {
          category: 'care_level',
          field_label: '介護度',
          previous: '要介護2',
          current: '要介護4',
          change_type: 'changed',
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <VisitBriefCard brief={brief} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('介護度')).toBeTruthy();
    expect(screen.getByText('変更')).toBeTruthy();
    expect(screen.getByText('要介護2 → 要介護4')).toBeTruthy();
  });

  it('shows drug codes for same-name medication changes so distinct drugs stay identifiable', () => {
    const queryClient = new QueryClient();
    const brief: VisitBrief = {
      ...buildBrief(),
      medication_changes: [
        {
          drug_name: '同名薬',
          drug_code: 'YJ_A',
          change_type: 'dose_changed',
          previous: '1錠 / 朝食後',
          current: '2錠 / 朝食後',
          prescribed_date: '2026-04-08T00:00:00.000Z',
          prescriber_name: '医師A',
        },
        {
          drug_name: '同名薬',
          drug_code: 'YJ_B',
          change_type: 'frequency_changed',
          previous: '1錠 / 夕食後',
          current: '1錠 / 眠前',
          prescribed_date: '2026-04-08T00:00:00.000Z',
          prescriber_name: '医師A',
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <VisitBriefCard brief={brief} />
      </QueryClientProvider>,
    );

    expect(screen.getAllByText('同名薬')).toHaveLength(2);
    expect(screen.getByText('YJ_A')).toBeTruthy();
    expect(screen.getByText('YJ_B')).toBeTruthy();
  });

  it('renders a removed change without a trailing arrow', () => {
    const queryClient = new QueryClient();
    const brief: VisitBrief = {
      ...buildBrief(),
      patient_changes: [
        {
          category: 'care_team',
          field_label: '多職種（主治医）',
          previous: '佐藤医師',
          current: null,
          change_type: 'removed',
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <VisitBriefCard brief={brief} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('多職種（主治医）')).toBeTruthy();
    expect(screen.getByText('解除')).toBeTruthy();
    expect(screen.getByText('佐藤医師')).toBeTruthy();
    // 末尾矢印で途切れないこと
    expect(screen.queryByText('佐藤医師 →')).toBeNull();
  });
});
