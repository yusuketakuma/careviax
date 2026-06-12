// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { InterprofessionalShareContent } from './interprofessional-share-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const REPORT = {
  id: 'rep_1',
  patient_id: 'pt_1',
  case_id: 'case_1',
  report_type: 'care_manager_report',
  status: 'sent',
  pdf_url: null,
  patient_summary: { id: 'pt_1', name: '加藤 ミサ' },
  content: {
    title: 'ケアマネへの服薬状況報告',
    patient: { name: '加藤 ミサ', birth_date: '1941-02-14' },
    care_manager: { name: '中島 桜', organization: 'きたきゅうケアプラン' },
    report_date: '2026-06-10',
    visit_date: '2026-06-10',
    pharmacist_name: '山田 花子',
    medication_management_summary: {
      total_drugs: 6,
      compliance_summary: '朝・夕は服用できています。昼分の飲み忘れが週2回ほどあります。',
      self_management: '一部介助',
      calendar_used: true,
    },
    functional_impact: {
      sleep_impact: '影響なし',
      cognition_impact: '変化なし',
      diet_impact: '食欲やや低下',
      mobility_impact: 'ふらつきなし',
      excretion_impact: '便秘気味',
    },
    residual_status: {
      summary: 'マグミット錠が約10日分残っています。',
      reduction_proposals: [],
    },
    care_service_coordination: {
      medication_assistance: '昼分はヘルパー訪問時の声かけをお願いしたいです。',
      unit_dose_packaging: true,
      calendar_recommendation: true,
      other_items: '',
    },
    next_visit_plan: { followup_items: ['昼分の服薬状況を確認'] },
    warnings: [],
  },
};

const CARE_TEAM = [
  { role: 'physician', name: '山本 健', organization_name: 'やまもと内科', is_primary: true },
  {
    role: 'care_manager',
    name: '中島 桜',
    organization_name: 'きたきゅうケアプラン',
    is_primary: true,
  },
];

const CONTACTS = [
  { relation: 'child', name: '加藤 直子', organization_name: null, is_primary: true },
];

const REQUESTS = [
  {
    id: 'req_1',
    recipient_name: '中島 桜',
    recipient_role: 'care_manager',
    status: 'responded',
    subject: 'ケアマネへの服薬状況報告(共有)',
    requested_at: '2026-06-10T06:30:00.000Z',
    responses: [
      { id: 'res_1', responder_name: '中島 桜(ケアマネ)', responded_at: '2026-06-12T07:40:00.000Z' },
    ],
  },
];

const REQUEST_DETAIL = {
  id: 'req_1',
  responses: [
    {
      id: 'res_1',
      responder_name: '中島 桜(ケアマネ)',
      content: 'ヘルパーへ声かけ依頼済み。次回確認をお願いします。',
      responded_at: '2026-06-12T07:40:00.000Z',
    },
  ],
};

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/care-reports/rep_1')) {
      return new Response(JSON.stringify({ data: REPORT }), { status: 200 });
    }
    if (url.includes('/api/patients/pt_1/care-team')) {
      return new Response(JSON.stringify({ data: CARE_TEAM }), { status: 200 });
    }
    if (url.includes('/api/patients/pt_1/contacts')) {
      return new Response(JSON.stringify({ data: CONTACTS }), { status: 200 });
    }
    if (url.includes('/api/communication-requests/req_1')) {
      return new Response(JSON.stringify({ data: REQUEST_DETAIL }), { status: 200 });
    }
    if (url.includes('/api/communication-requests?')) {
      return new Response(JSON.stringify({ data: REQUESTS }), { status: 200 });
    }
    if (url.includes('/api/tasks') && init?.method === 'POST') {
      return new Response(JSON.stringify({ data: { id: 'task_1' } }), { status: 201 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderShare() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InterprofessionalShareContent reportId="rep_1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InterprofessionalShareContent', () => {
  it('3 カラム(共有する相手 / 相手に見える内容 / 返信・確認)を描画する', async () => {
    stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-audience-column')).toBeTruthy();
    });

    // 左: 相手 5 区分。報告書タイプ(ケアマネ向け)からケアマネが選択中
    const cards = screen.getAllByTestId('share-audience-card');
    expect(cards).toHaveLength(5);
    expect(cards.map((card) => card.getAttribute('data-audience'))).toEqual([
      'physician',
      'care_manager',
      'visiting_nurse',
      'facility',
      'family',
    ]);
    const selected = cards.find((card) => card.getAttribute('aria-pressed') === 'true');
    expect(selected?.getAttribute('data-audience')).toBe('care_manager');
    await waitFor(() => {
      expect(screen.getByText('中島 桜(きたきゅうケアプラン)')).toBeTruthy();
    });

    // 中央: 5 セクションのプレビュー
    const sections = screen.getAllByTestId('share-preview-section');
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual([
      '服薬状況',
      '残薬',
      '薬剤師からのお願い',
      '次回確認すること',
      '添付資料',
    ]);
    expect(screen.getByText(/昼分の飲み忘れが週2回/)).toBeTruthy();

    // 右: ケアマネからの返信と主操作
    expect(screen.getByText('ケアマネからの返信')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card').textContent).toContain(
        'ヘルパーへ声かけ依頼済み',
      );
    });
  });

  it('相手を切り替えると返信パネルが空状態になる(主治医宛て返信なし)', async () => {
    stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5);
    });

    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );

    expect(screen.getByText('主治医からの返信')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('share-reply-empty')).toBeTruthy();
    });
    const button = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('「次回タスクにする」で POST /api/tasks に重複防止キーつきで起票する', async () => {
    const fetchMock = stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });

    const button = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('次回タスク作成済み')).toBeTruthy();
    });

    const taskCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/tasks' && init?.method === 'POST',
    );
    expect(taskCall).toBeTruthy();
    const body = JSON.parse(String(taskCall?.[1]?.body));
    expect(body.task_type).toBe('share_reply_followup');
    expect(body.dedupe_key).toBe('share-reply-task:res_1');
    expect(body.related_entity_type).toBe('patient');
    expect(body.related_entity_id).toBe('pt_1');
    expect(body.title).toContain('ケアマネからの返信');

    // 起票済みの返信では再実行できない
    expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
