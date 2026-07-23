import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getMedicationsContentTestSupport } from './medications-content.test-support';

const { MedicationsContent, useMutationMock, useOrgIdMock, useQueryClientMock, useQueryMock } =
  getMedicationsContentTestSupport();

describe('MedicationsContent', () => {
  it('renders medication workflow groups with semantic headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'medication-profiles') {
        return {
          data: {
            data: [
              {
                id: 'profile_1',
                patient_id: 'patient_1',
                drug_name: 'アムロジピン錠5mg',
                dose: '1錠',
                frequency: '朝食後',
                start_date: '2026-06-01',
                end_date: null,
                prescriber: '佐藤医師',
                is_current: true,
                source: 'manual',
                created_at: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
          isLoading: false,
        };
      }
      if (queryKey[0] === 'medication-issues') {
        return {
          data: {
            data: [
              {
                id: 'issue_1',
                patient_id: 'patient_1',
                case_id: 'case_1',
                title: 'アムロジピン飲み忘れ',
                description: '夕食後薬を2日続けて飲み忘れています。',
                status: 'open',
                priority: 'high',
                category: 'adherence',
                identified_at: '2026-06-10T09:00:00.000Z',
                resolved_at: null,
              },
            ],
          },
          isLoading: false,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
      };
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

    expect(screen.getByRole('heading', { level: 2, name: '服薬中薬剤' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 3, name: '見やすい薬剤一覧' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { level: 2, name: '薬学的課題と照会' }).tagName).toBe('H2');
    const issueEdit = screen.getByRole('button', { name: '薬学的課題1件目を編集' });
    expect(issueEdit.getAttribute('aria-label')).not.toMatch(/山田|アムロジピン|飲み忘れ|夕食後/);
    expect(screen.getByRole('heading', { level: 2, name: 'アレルギー・副作用歴' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByRole('heading', { level: 2, name: '残薬管理と次回提案' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'お薬手帳QR発行' }).tagName).toBe('H2');
    expect(screen.getAllByText('アムロジピン錠5mg').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'QRスキャン' }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'QR発行' }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: '薬剤追加' }).className).toContain('min-h-[44px]');

    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登録' })).toBeTruthy();

    fireEvent.click(issueEdit);
    expect(screen.getByRole('dialog', { name: '薬学的課題を更新' })).toBeTruthy();
  }, 15_000);

  it('renders a submit failure as a safe assertive alert, not a raw String(error)', () => {
    // Regression: the add-medication dialog rendered {String(mutation.error)} which leaks the
    // "Error: " prefix and was not a live region. The failure must announce assertively (WCAG
    // 4.1.3) and show only the message — a direct response to the user's 登録 action.
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('登録に失敗しました: 重複した処方です'),
    });
    useQueryMock.mockImplementation(() => ({ data: { data: [] }, isLoading: false }));

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

    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toBe('登録に失敗しました');
    // a raw String(new Error(msg)) renders "Error: msg" — prove that prefix is gone
    expect(alert.textContent).not.toContain('Error:');
    expect(alert.textContent).not.toContain('重複した処方です');
  });

  it('falls back for add-medication submit failures with empty Error messages', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error(''),
    });
    useQueryMock.mockImplementation(() => ({ data: { data: [] }, isLoading: false }));

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

    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toBe('登録に失敗しました');
  });
});
