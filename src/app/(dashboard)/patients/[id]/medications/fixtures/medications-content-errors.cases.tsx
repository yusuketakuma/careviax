import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MedicationsContentPropsForTest } from './medications-content.test-support';
import { getMedicationsContentTestSupport } from './medications-content.test-support';

const { MedicationsContent, useMutationMock, useOrgIdMock, useQueryClientMock, useQueryMock } =
  getMedicationsContentTestSupport();

describe('MedicationsContent fetch-error surfaces (no false-empty)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderWithErrorKey(errorKey: string, options: { providePatientContext?: boolean } = {}) {
    const refetch = vi.fn();
    const providePatientContext = options.providePatientContext ?? true;
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === errorKey) {
        // fetch failure: query throws → data stays undefined, isError flips true
        return { data: undefined, isLoading: false, isError: true, refetch };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });
    const patientContext: Partial<MedicationsContentPropsForTest> = providePatientContext
      ? {
          patientName: '山田花子',
          patientNameKana: 'ヤマダハナコ',
          birthDate: '1950-04-01',
          gender: 'female',
          allergyInfo: [],
        }
      : {};
    render(<MedicationsContent patientId="patient_1" {...patientContext} />);
    return { refetch };
  }

  it('uses a named skeleton while medication profiles are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === 'medication-profiles') {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('status', { name: '服薬中薬剤を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'div' })).toBeNull();
    expect(screen.queryByText(/服薬中薬剤を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText('服薬中の薬剤がありません')).toBeNull();
  });

  it('uses a named skeleton while medication issues are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === 'medication-issues') {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('status', { name: '薬学的課題を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('課題を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText(/薬学的課題を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText(/課題はまだ登録されていません/)).toBeNull();
  });

  it('uses a named skeleton while inquiry records are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === 'inquiry-records') {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('status', { name: '疑義照会を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('疑義照会を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText(/疑義照会の記録を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText('疑義照会の記録はありません。')).toBeNull();
  });

  it('uses a named skeleton while residual suggestions are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === 'residual-medications') {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('status', { name: '残薬提案を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('残薬提案を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText(/残薬提案を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText(/7日超の余剰や減数禁止薬の注意はまだありません/)).toBeNull();
  });

  // A failed fetch must surface an error + retry, never collapse into a "0 件 / 記録なし" state
  // that masks unresolved medical issues, pending inquiries, or excess-medication warnings.
  it.each([
    ['medication-profiles', '服薬中薬剤を読み込めませんでした', '服薬中の薬剤がありません'],
    ['medication-issues', '薬学的課題を読み込めませんでした', '課題はまだ登録されていません'],
    ['inquiry-records', '疑義照会の記録を読み込めませんでした', '疑義照会の記録はありません'],
    [
      'residual-medications',
      '残薬提案を読み込めませんでした',
      '7日超の余剰や減数禁止薬の注意はまだありません',
    ],
  ])(
    'surfaces an error with retry instead of a false-empty state when %s fetch fails',
    (errorKey, errorMessage, falseEmptyText) => {
      const { refetch } = renderWithErrorKey(errorKey);

      expect(screen.getByText(new RegExp(errorMessage))).toBeTruthy();
      // the misleading empty-state copy must NOT be shown when the fetch actually failed
      expect(screen.queryByText(new RegExp(falseEmptyText))).toBeNull();

      const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
      expect(retryButtons.length).toBeGreaterThan(0);
      fireEvent.click(retryButtons[0]);
      expect(refetch).toHaveBeenCalled();
    },
  );

  // A failed source must not leak through OTHER consumers either: the count badges and the
  // side-effect history both derive from medication-issues, so an issuesQuery failure must not
  // render a confirmed 0 count or the "副作用歴はまだ登録されていません" false-empty.
  it('does not leak medication-issues failure as false-zero badges or a false-empty 副作用歴 section', () => {
    const { refetch } = renderWithErrorKey('medication-issues');

    // second consumer (side-effect history) must not collapse into its empty copy
    expect(screen.queryByText(/副作用歴はまだ登録されていません/)).toBeNull();

    // count badges must not present a confirmed 0 when the owning query failed
    expect(document.body.textContent).toContain('未解決課題 —');
    expect(document.body.textContent).toContain('副作用歴 —');
    expect(document.body.textContent).not.toContain('未解決課題 0');
    expect(document.body.textContent).not.toContain('副作用歴 0');

    // both the issue list and the side-effect section expose a retry wired to issuesQuery.refetch
    const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
    expect(retryButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    expect(refetch).toHaveBeenCalled();
  });

  it('does not leak patient summary failure as a false-empty allergy section', () => {
    const { refetch } = renderWithErrorKey('patient-medication-summary', {
      providePatientContext: false,
    });

    expect(screen.getByText(/アレルギー情報を読み込めませんでした/)).toBeTruthy();
    expect(screen.queryByText('登録なし')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps fetched patient summary allergy success rendering unchanged', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      const key = String(queryKey[0]);
      if (key === 'patient-medication-summary') {
        return {
          data: {
            name: '山田花子',
            name_kana: 'ヤマダハナコ',
            birth_date: '1950-04-01',
            gender: 'female',
            allergy_info: ['ペニシリン'],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<MedicationsContent patientId="patient_1" />);

    expect(screen.getByText('ペニシリン')).toBeTruthy();
    expect(screen.queryByText(/アレルギー情報を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText('登録なし')).toBeNull();
  });

  it('does not leak inquiry-records failure as a false-zero 回答待ち照会 badge', () => {
    renderWithErrorKey('inquiry-records');

    expect(document.body.textContent).toContain('回答待ち照会 —');
    expect(document.body.textContent).not.toContain('回答待ち照会 0');
  });
});
