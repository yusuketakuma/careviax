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
    medications: [],
    dispensing_items: [],
    delivery_status: [],
    dosage_form_support: [],
    multidisciplinary_updates: [],
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
      </QueryClientProvider>
    );

    expect(screen.getByText('退院前カンファレンス')).toBeTruthy();
    expect(
      screen.getByText('退院後初回訪問。持参薬の確認と生活指導が優先。')
    ).toBeTruthy();
    expect(screen.getByText('服薬アドヒアランス低下')).toBeTruthy();
    expect(screen.getByText('転倒リスク')).toBeTruthy();
  });
});
