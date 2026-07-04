// @vitest-environment jsdom

import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';
import { DrugSuggest } from './drug-suggest';

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

function DrugSuggestHarness() {
  const [value, setValue] = useState('');
  return <DrugSuggest value={value} onTextChange={setValue} onSelect={vi.fn()} />;
}

describe('DrugSuggest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces the query key before enabling candidate search', async () => {
    vi.useFakeTimers();

    render(<DrugSuggestHarness />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ア' } });
    fireEvent.change(input, { target: { value: 'アム' } });

    let latestOptions = useQueryMock.mock.calls.at(-1)?.[0];
    expect(latestOptions?.queryKey).toEqual(['drug-suggest', 'org_1', '']);
    expect(latestOptions?.enabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(249);
    });

    latestOptions = useQueryMock.mock.calls.at(-1)?.[0];
    expect(latestOptions?.queryKey).toEqual(['drug-suggest', 'org_1', '']);
    expect(latestOptions?.enabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    latestOptions = useQueryMock.mock.calls.at(-1)?.[0];
    expect(latestOptions?.queryKey).toEqual(['drug-suggest', 'org_1', 'アム']);
    expect(latestOptions?.enabled).toBe(true);
  });

  it('uses the lightweight drug-master search endpoint for typeahead results', async () => {
    const fetchMock = stubJsonFetch({ data: [] });

    render(<DrugSuggest value="アム" onTextChange={vi.fn()} onSelect={vi.fn()} />);

    const latestOptions = useQueryMock.mock.calls.at(-1)?.[0];
    await latestOptions.queryFn();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1]);
    expect(params.get('q')).toBe('アム');
    expect(params.get('limit')).toBe('10');
    expect(params.get('includeTotal')).toBe('false');
    expect(init).toMatchObject({
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('uses unique listbox ids and exposes the focused option for keyboard users', () => {
    useQueryMock.mockReturnValue({
      data: [
        {
          id: 'drug_1',
          drug_name: 'アムロジピン錠',
          yj_code: '2171013F1024',
          dosage_form: '錠剤',
          unit: '錠',
          manufacturer: 'テスト製薬',
          is_generic: false,
          is_narcotic: false,
          is_psychotropic: false,
          max_administration_days: null,
          drug_price: 12.3,
        },
      ],
    });

    render(
      <div>
        <DrugSuggest
          value="アム"
          onTextChange={vi.fn()}
          onSelect={vi.fn()}
          ariaLabel="明細行1の薬剤名"
        />
        <DrugSuggest
          value="アム"
          onTextChange={vi.fn()}
          onSelect={vi.fn()}
          ariaLabel="明細行2の薬剤名"
        />
      </div>,
    );

    const firstInput = screen.getByRole('combobox', { name: '明細行1の薬剤名' });
    const secondInput = screen.getByRole('combobox', { name: '明細行2の薬剤名' });

    fireEvent.focus(firstInput);
    fireEvent.focus(secondInput);

    const listboxes = screen.getAllByRole('listbox');
    expect(listboxes[0].id).not.toBe(listboxes[1].id);

    fireEvent.keyDown(firstInput, { key: 'ArrowDown' });

    expect(firstInput.getAttribute('aria-activedescendant')).toBe(
      `${listboxes[0].id}-option-drug_1`,
    );
  });

  it('returns the selected DrugMaster id with the YJ code', () => {
    const onSelect = vi.fn();
    const onTextChange = vi.fn();
    useQueryMock.mockReturnValue({
      data: [
        {
          id: 'drug_1',
          drug_name: 'アムロジピン錠',
          yj_code: '2171013F1024',
          dosage_form: '錠剤',
          unit: '錠',
          manufacturer: 'テスト製薬',
          is_generic: false,
          is_narcotic: false,
          is_psychotropic: false,
          max_administration_days: null,
          drug_price: 12.3,
        },
      ],
    });

    render(<DrugSuggest value="アム" onTextChange={onTextChange} onSelect={onSelect} />);

    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /アムロジピン錠/ }));

    expect(onTextChange).toHaveBeenCalledWith('アムロジピン錠');
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        drug_master_id: 'drug_1',
        drug_code: '2171013F1024',
        drug_name: 'アムロジピン錠',
      }),
    );
  });

  it('surfaces a retryable error instead of a silent empty list when the search fails', async () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({ data: undefined, isError: true, refetch });

    render(<DrugSuggestHarness />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'アム' } });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    // 取得失敗が「候補なし(空 listbox)」に化けず、再試行導線つきで明示される。
    expect(screen.getByText(/候補を取得できませんでした/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalled();
  });
});
