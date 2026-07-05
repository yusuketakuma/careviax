// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { VisitBrief } from '@/types/visit-brief';
import { VisitBriefCard } from './visit-brief-card';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn(() => 'org_1'));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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
    latest_labs: [],
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

function renderBriefCard(brief: VisitBrief) {
  return render(<VisitBriefCard brief={brief} />, { wrapper: createQueryClientWrapper() });
}

describe('VisitBriefCard', () => {
  it('renders conference summary and highlighted risks when available', () => {
    renderBriefCard(buildBrief());

    expect(screen.getByText('退院前カンファレンス')).toBeTruthy();
    expect(screen.getByText('退院後初回訪問。持参薬の確認と生活指導が優先。')).toBeTruthy();
    expect(screen.getByText('服薬アドヒアランス低下')).toBeTruthy();
    expect(screen.getByText('転倒リスク')).toBeTruthy();
  });

  it('surfaces archived patient state in the brief header', () => {
    const brief: VisitBrief = {
      ...buildBrief(),
      patient: {
        ...buildBrief().patient,
        archive: {
          status: 'archived',
          archived: true,
          archived_at: '2026-06-30T09:00:00.000Z',
        },
      },
    };

    renderBriefCard(brief);

    expect(screen.getByText('アーカイブ中')).toBeTruthy();
  });

  it('renders the empty state when there are no patient changes', () => {
    renderBriefCard(buildBrief());

    expect(screen.getByText('前回訪問以降の患者情報変更はありません。')).toBeTruthy();
  });

  it('renders patient changes with a change-type badge and previous→current detail', () => {
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

    renderBriefCard(brief);

    expect(screen.getByText('介護度')).toBeTruthy();
    expect(screen.getByText('変更')).toBeTruthy();
    expect(screen.getByText('要介護2 → 要介護4')).toBeTruthy();
  });

  it('shows drug codes for same-name medication changes so distinct drugs stay identifiable', () => {
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

    renderBriefCard(brief);

    expect(screen.getAllByText('同名薬')).toHaveLength(2);
    expect(screen.getByText('YJ_A')).toBeTruthy();
    expect(screen.getByText('YJ_B')).toBeTruthy();
  });

  it('renders a removed change without a trailing arrow', () => {
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

    renderBriefCard(brief);

    expect(screen.getByText('多職種（主治医）')).toBeTruthy();
    expect(screen.getByText('解除')).toBeTruthy();
    expect(screen.getByText('佐藤医師')).toBeTruthy();
    // 末尾矢印で途切れないこと
    expect(screen.queryByText('佐藤医師 →')).toBeNull();
  });

  it('lists outside-med classification (その他薬) for classified dispensing items (§11-7)', () => {
    const brief: VisitBrief = {
      ...buildBrief(),
      dispensing_items: [
        {
          drug_name: 'モーラステープ',
          dispensing_method: null,
          packaging_instructions: null,
          set_method: null,
          set_period_label: null,
          audit_status: null,
          outside_med_kind: 'topical',
          outside_med_label: '外用',
          note: '',
        },
        {
          drug_name: '一包化対象錠',
          dispensing_method: '一包化',
          packaging_instructions: null,
          set_method: null,
          set_period_label: null,
          audit_status: null,
          outside_med_kind: null,
          outside_med_label: null,
          note: '一包化',
        },
      ],
    };

    renderBriefCard(brief);

    expect(screen.getByText('その他薬（セット外で持参）')).toBeTruthy();
    expect(screen.getByText('外用')).toBeTruthy();
    // モーラステープは調剤方法とその他薬セクションの両方に出るため複数一致を許容。
    expect(screen.getAllByText('モーラステープ').length).toBeGreaterThan(0);
  });

  it('omits the その他薬 section when no dispensing item is classified', () => {
    renderBriefCard(buildBrief());

    expect(screen.queryByText('その他薬（セット外で持参）')).toBeNull();
  });

  it('renders multidisciplinary update actions beside the communication evidence', () => {
    const href = '/communications/requests?status=sent&patient_id=patient_1&request_id=request_1';
    const brief: VisitBrief = {
      ...buildBrief(),
      multidisciplinary_updates: [
        {
          source_type: 'request',
          title: '降圧薬の減量相談',
          summary: '処方医フォロー / sent / ふらつき継続のため確認',
          occurred_at: '2026-04-09T10:00:00.000Z',
          counterpart: null,
          severity: 'high',
          action_href: href,
          action_label: '依頼を確認',
        },
      ],
    };

    renderBriefCard(brief);

    const link = screen.getByRole('link', { name: /依頼を確認/ });
    expect(link.getAttribute('href')).toBe(href);
  });

  it('renders delivery status actions beside the report delivery evidence', () => {
    const href = '/reports/report_1';
    const brief: VisitBrief = {
      ...buildBrief(),
      delivery_status: [
        {
          title: '医師報告書の送達',
          status_bucket: 'reply_waiting',
          summary: '在宅主治医 / fax / response_waiting',
          occurred_at: '2026-04-09T10:00:00.000Z',
          action_href: href,
        },
      ],
    };

    renderBriefCard(brief);

    const link = screen.getByRole('link', { name: /共有を確認/ });
    expect(link.getAttribute('href')).toBe(href);
  });

  it('renders latest lab excerpts with abnormal and stale labels', () => {
    const brief: VisitBrief = {
      ...buildBrief(),
      latest_labs: [
        {
          analyte_code: 'egfr',
          analyte_label: 'eGFR',
          value_numeric: 38,
          unit: 'mL/min/1.73m2',
          value_label: '38 mL/min/1.73m2',
          measured_at: '2025-01-01T00:00:00.000Z',
          measured_at_label: '2025-01-01',
          stale: true,
          abnormal: true,
          abnormal_flag: 'L',
        },
      ],
    };

    renderBriefCard(brief);

    expect(screen.getByText('最新検査値')).toBeTruthy();
    expect(screen.getByText('eGFR')).toBeTruthy();
    expect(screen.getByText('38 mL/min/1.73m2')).toBeTruthy();
    expect(screen.getByText('測定日 2025-01-01')).toBeTruthy();
    expect(screen.getByText('異常 L')).toBeTruthy();
    expect(screen.getByText('測定日確認')).toBeTruthy();
  });

  it('renders unresolved item actions beside the blocker evidence', () => {
    const href = '/reports/report_2';
    const brief: VisitBrief = {
      ...buildBrief(),
      unresolved_items: [
        {
          source_type: 'task',
          title: '報告送達フォロー',
          summary: '未確認報告を確認してください',
          severity: 'high',
          href,
        },
      ],
    };

    renderBriefCard(brief);

    const link = screen.getByRole('link', { name: /確認する/ });
    expect(link.getAttribute('href')).toBe(href);
  });

  it('keeps API messages from visit brief feedback failures', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: '訪問要約フィードバックの送信権限がありません' }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderBriefCard(buildBrief());

      fireEvent.click(screen.getByRole('button', { name: '実用的' }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('訪問要約フィードバックの送信権限がありません');
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/visit-brief-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({
          patient_id: 'patient_1',
          context: 'patient',
          generation_id: 'rule_1',
          summary_kind: 'rule',
          rating: 'helpful',
          provider: 'rule',
          requested_provider: 'rule',
          model: null,
          is_fallback: false,
        }),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
