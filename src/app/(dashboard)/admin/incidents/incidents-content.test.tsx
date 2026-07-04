// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INCIDENT_REPORTS_API_PATH,
  buildIncidentReportApiPath,
} from '@/lib/incident-reports/api-paths';
import { useAuthStore } from '@/lib/stores/auth-store';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
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
    severity: 'near_miss',
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

function stubIncidentFetch(reports: IncidentReportListItem[]) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'PATCH' ? { data: { id: reports[0]?.id } } : { data: reports },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

// Base UI Select renders a portaled listbox jsdom can't drive; mock it to a native <select>
// (same approach as drug-master-content.test.tsx / pca-pumps-content.test.tsx) so status-change
// interaction is testable. Forwards the SelectTrigger's id/data-testid/aria-* so existing
// getByTestId('incident-related-process') queries keep resolving.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  type ItemProps = { value?: string; children?: ReactNode };
  type TriggerProps = {
    id?: string;
    'data-testid'?: string;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    children?: ReactNode;
  };

  const SelectContent = ({ children }: { children: ReactNode }) => <>{children}</>;
  const SelectItem = ({ children }: ItemProps) => <>{children}</>;
  const SelectTrigger = ({ children }: TriggerProps) => <>{children}</>;
  const SelectValue = ({ placeholder }: { placeholder?: string }) => <>{placeholder ?? null}</>;

  function collectItems(children: ReactNode): ItemProps[] {
    const items: ItemProps[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as ItemProps;
      if (child.type === SelectItem) items.push({ value: props.value, children: props.children });
      items.push(...collectItems(props.children));
    });
    return items;
  }

  function findTriggerProps(children: ReactNode): TriggerProps | undefined {
    let triggerProps: TriggerProps | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as TriggerProps;
      if (child.type === SelectTrigger) triggerProps = props;
      if (!triggerProps) triggerProps = findTriggerProps(props.children);
    });
    return triggerProps;
  }

  function MockSelect({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) {
    const triggerProps = findTriggerProps(children);
    const items = collectItems(children);
    return (
      <select
        id={triggerProps?.id}
        data-testid={triggerProps?.['data-testid']}
        aria-label={triggerProps?.['aria-label']}
        aria-labelledby={triggerProps?.['aria-labelledby']}
        aria-describedby={triggerProps?.['aria-describedby']}
        disabled={disabled}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        <option value="" />
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {React.Children.toArray(item.children).join('')}
          </option>
        ))}
      </select>
    );
  }

  return {
    Select: MockSelect,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
});

setupDomTestEnv();

describe('IncidentsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().resetAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
  });

  it('connects the empty-list disabled reason to memo controls and blocks direct submit', async () => {
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

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

  it('fetches incident reports from the shared collection API path with org header', async () => {
    const fetchMock = stubIncidentFetch([makeReport()]);
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

    expect(await screen.findByText('取り違えヒヤリ')).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledWith(INCIDENT_REPORTS_API_PATH, {
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('PATCH saves memo updates through the encoded detail API path without changing payloads', async () => {
    const reportId = 'incident/1?mode=x#frag';
    const fetchMock = stubIncidentFetch([
      makeReport({
        id: reportId,
        title: '輸液ポンプ設定ヒヤリ',
        cause: '指差し確認不足',
        immediate_action: '薬剤師が再確認した',
        prevention_plan: 'チェック表を更新',
        related_process: 'dispensing',
      }),
    ]);
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

    const causeInput = await screen.findByLabelText('原因');
    fireEvent.change(causeInput, { target: { value: 'ダブルチェック不足' } });
    fireEvent.submit(screen.getByTestId('incident-memo-form'));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true);
    });

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    const [, init] = patchCall as [RequestInfo | URL, RequestInit];
    expect(patchCall?.[0]).toBe(buildIncidentReportApiPath(reportId));
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-org-id': 'org_1' });
    expect(JSON.parse(String(init.body))).toEqual({
      what_happened: '別患者の薬を渡しかけた',
      cause: 'ダブルチェック不足',
      immediate_action: '薬剤師が再確認した',
      prevention_plan: 'チェック表を更新',
      related_process: 'dispensing',
    });
  });

  it('keeps server memo save messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [makeReport()] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: '同時更新されています' }), { status: 409 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

    await screen.findByText('取り違えヒヤリ');
    fireEvent.submit(screen.getByTestId('incident-memo-form'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('同時更新されています');
    });
  });

  it('falls back to the memo save message when PATCH fails without a message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [makeReport()] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

    await screen.findByText('取り違えヒヤリ');
    fireEvent.submit(screen.getByTestId('incident-memo-form'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('再発防止メモの保存に失敗しました');
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
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

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
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

    await screen.findByLabelText('起きたこと');
    expect(screen.getAllByText('未入力')).toHaveLength(4);

    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '取り違え' } });
    expect(screen.getAllByText('未入力')).toHaveLength(3);
  });

  it('does not show per-field 未入力 chips when no record is selected', async () => {
    stubReports([]);
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

    expect(await screen.findByText('ヒヤリハット記録はまだありません')).toBeTruthy();
    // 上部サマリー(『未入力: …』)とは別物の per-field チップは未選択時には出さない。
    expect(screen.queryByText('未入力')).toBeNull();
    expect(screen.getByText('記録一覧に記録がないため入力できません。')).toBeTruthy();
  });

  it('drops the fixed 640px min-height from both panels', async () => {
    stubReports([makeReport()]);
    render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

    await screen.findByLabelText('起きたこと');
    expect(screen.getByRole('region', { name: '記録一覧' }).className).not.toContain(
      'min-h-[640px]',
    );
    expect(screen.getByRole('region', { name: '再発防止メモ' }).className).not.toContain(
      'min-h-[640px]',
    );
  });

  describe('status/severity display and status change (canAdmin)', () => {
    it('shows severity and status badges for each record in the list', async () => {
      stubReports([makeReport({ severity: 'level2', status: 'reviewed' })]);
      render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

      await screen.findByText('取り違えヒヤリ');
      expect(screen.getAllByText('レベル2以上（中等度以上）').length).toBeGreaterThan(0);
      expect(screen.getAllByText('確認済み').length).toBeGreaterThan(0);
    });

    it('renders a read-only status badge (no select) for a non-admin role', async () => {
      useAuthStore.getState().setCurrentUser({ role: 'pharmacist' });
      stubReports([makeReport({ status: 'open' })]);
      render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

      await screen.findByText('取り違えヒヤリ');
      expect(screen.queryByTestId('incident-status-select')).toBeNull();
      expect(screen.getAllByText('未対応').length).toBeGreaterThan(0);
    });

    it('shows a status change select for an admin role and PATCHes the new status', async () => {
      useAuthStore.getState().setCurrentUser({ role: 'admin' });
      const fetchMock = stubIncidentFetch([makeReport({ id: 'incident_1', status: 'open' })]);
      render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

      await screen.findByText('取り違えヒヤリ');
      const statusSelect = screen.getByTestId('incident-status-select');
      expect(statusSelect).toBeTruthy();

      fireEvent.change(statusSelect, { target: { value: 'reviewed' } });

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(patchCall).toBeTruthy();
        expect(JSON.parse(String((patchCall as [RequestInfo, RequestInit])[1].body))).toEqual({
          status: 'reviewed',
        });
      });
    });

    it('falls back to the status-change message when status PATCH fails without a message', async () => {
      useAuthStore.getState().setCurrentUser({ role: 'admin' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: [makeReport({ id: 'incident_1', status: 'open' })] }),
            {
              status: 200,
            },
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

      await screen.findByText('取り違えヒヤリ');
      fireEvent.change(screen.getByTestId('incident-status-select'), {
        target: { value: 'reviewed' },
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('ステータスの変更に失敗しました');
      });
    });
  });

  describe('create flow', () => {
    it('opens the create sheet, requires a title, and POSTs the new record', async () => {
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Response(
            init?.method === 'POST'
              ? JSON.stringify({
                  data: makeReport({ id: 'incident_new', title: '新規記録' }),
                })
              : JSON.stringify({ data: [] }),
            { status: init?.method === 'POST' ? 201 : 200 },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

      await screen.findByText('ヒヤリハット記録はまだありません');
      fireEvent.click(screen.getByRole('button', { name: '新規記録' }));

      const submit = screen.getByRole('button', { name: '作成する' });
      expect(submit).toHaveProperty('disabled', true);

      fireEvent.change(screen.getByLabelText('表題'), { target: { value: '新規記録' } });
      expect(submit).toHaveProperty('disabled', false);

      fireEvent.click(submit);

      await waitFor(() => {
        const postCall = fetchMock.mock.calls.find(
          ([input, init]) =>
            String(input) === INCIDENT_REPORTS_API_PATH &&
            (init as RequestInit | undefined)?.method === 'POST',
        );
        expect(postCall).toBeTruthy();
        expect(JSON.parse(String((postCall as [RequestInfo, RequestInit])[1].body))).toEqual({
          title: '新規記録',
          occurred_at: null,
        });
      });
    });

    it('falls back to the create message when record creation fails without a message', async () => {
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Response(
            init?.method === 'POST' ? JSON.stringify({}) : JSON.stringify({ data: [] }),
            {
              status: init?.method === 'POST' ? 500 : 200,
            },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<IncidentsContent />, { wrapper: createQueryClientWrapper() });

      await screen.findByText('ヒヤリハット記録はまだありません');
      fireEvent.click(screen.getByRole('button', { name: '新規記録' }));
      fireEvent.change(screen.getByLabelText('表題'), { target: { value: '新規記録' } });
      fireEvent.click(screen.getByRole('button', { name: '作成する' }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('記録の作成に失敗しました');
      });
    });
  });
});
