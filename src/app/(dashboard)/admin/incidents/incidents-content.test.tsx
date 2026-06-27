// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { IncidentsContent } from './incidents-content';
import type { IncidentReportListItem } from './incidents-form';

function makeReport(overrides: Partial<IncidentReportListItem> = {}): IncidentReportListItem {
  return {
    id: 'incident_1',
    title: '取り違えヒヤリ',
    what_happened: '別患者の薬を渡しかけた',
    cause: null,
    immediate_action: null,
    prevention_plan: null,
    related_process: null,
    severity: 'low',
    status: 'open',
    occurred_at: '2026-06-20T01:00:00.000Z',
    created_at: '2026-06-20T01:00:00.000Z',
    updated_at: '2026-06-20T01:00:00.000Z',
    ...overrides,
  };
}

function stubReports(reports: IncidentReportListItem[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: reports }), { status: 200 })),
  );
}

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

setupDomTestEnv();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('IncidentsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
  });

  it('connects the empty-list disabled reason to memo controls and blocks direct submit', async () => {
    render(<IncidentsContent />, { wrapper: createWrapper() });

    // 空一覧は共通 EmptyState で表示される(タイトルに句点なし)
    expect(await screen.findByText('ヒヤリハット記録はまだありません')).toBeTruthy();

    const disabledReason = screen.getByText('記録一覧に記録がないため入力できません。');
    const whatHappenedInput = screen.getByLabelText('起きたこと');
    const processSelect = screen.getByTestId('incident-related-process');
    const saveButton = screen.getByRole('button', { name: '不足ありで保存' });

    expect(whatHappenedInput).toHaveProperty('disabled', true);
    expect(whatHappenedInput.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(processSelect.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(disabledReason.textContent).not.toMatch(/patient_|incident_|山田|太郎/);

    fireEvent.submit(screen.getByTestId('incident-memo-form'));

    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([input, init]) =>
              String(input).startsWith('/api/incident-reports/') && init?.method === 'PATCH',
          ),
      ).toBe(false);
    });
  });

  it('renders the narrative memo fields as textareas while keeping the related-process select', async () => {
    stubReports([
      makeReport({
        what_happened: '記録あり',
        cause: '原因あり',
        immediate_action: '対応',
        prevention_plan: '対策',
        related_process: 'dispensing',
      }),
    ]);
    render(<IncidentsContent />, { wrapper: createWrapper() });

    const whatHappened = await screen.findByLabelText('起きたこと');
    expect(whatHappened.tagName).toBe('TEXTAREA');
    expect(whatHappened.getAttribute('placeholder')).toBe('起きたことを記録');
    for (const label of ['原因', 'すぐ行った対応', '次から変えること']) {
      expect(screen.getByLabelText(label).tagName).toBe('TEXTAREA');
    }
    // 関係する工程 は分類値なので Select(非 textarea)のまま。
    expect(screen.getByTestId('incident-related-process').tagName).not.toBe('TEXTAREA');
  });

  it('marks empty memo fields with a 未入力 chip that clears once the field is filled', async () => {
    // what_happened のみ記入済み → cause / immediate / prevention / related_process が未入力(4件)。
    stubReports([makeReport()]);
    render(<IncidentsContent />, { wrapper: createWrapper() });

    await screen.findByLabelText('起きたこと');
    expect(screen.getAllByText('未入力')).toHaveLength(4);

    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '取り違え' } });
    expect(screen.getAllByText('未入力')).toHaveLength(3);
  });

  it('does not show per-field 未入力 chips when no record is selected', async () => {
    stubReports([]);
    render(<IncidentsContent />, { wrapper: createWrapper() });

    expect(await screen.findByText('ヒヤリハット記録はまだありません')).toBeTruthy();
    // 上部サマリー(『未入力: …』)とは別物の per-field チップは未選択時には出さない。
    expect(screen.queryByText('未入力')).toBeNull();
    expect(screen.getByText('記録一覧に記録がないため入力できません。')).toBeTruthy();
  });

  it('drops the fixed 640px min-height from both panels', async () => {
    stubReports([makeReport()]);
    render(<IncidentsContent />, { wrapper: createWrapper() });

    await screen.findByLabelText('起きたこと');
    expect(screen.getByRole('region', { name: '記録一覧' }).className).not.toContain(
      'min-h-[640px]',
    );
    expect(screen.getByRole('region', { name: '再発防止メモ' }).className).not.toContain(
      'min-h-[640px]',
    );
  });
});
