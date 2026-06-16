// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientMcsContent } from './mcs-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PatientMcsContent', () => {
  it('shows an inline validation error and keeps actions disabled for invalid draft urls', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: null,
          projectTitle: null,
          projectMemo: null,
          memberCount: null,
          lastSyncAttemptAt: null,
          lastSyncedAt: null,
          lastSyncError: null,
        },
        profile: null,
        summary: null,
        messages: [],
        checkLogs: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    expect(screen.getByRole('heading', { level: 2, name: 'MCS 連携状況' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: 'MCS要点サマリー' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: 'MCS 確認ログ' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: '取り込み済みメッセージ' }).tagName).toBe(
      'H2',
    );

    fireEvent.change(screen.getByLabelText('MCS 連携元 URL'), {
      target: { value: 'invalid-url' },
    });

    await waitFor(() => {
      expect(
        screen.getByText('MCS の患者 URL または医療・介護側タイムライン URL を入力してください'),
      ).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: '今すぐ同期' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'MCS で開く' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '患者ページ' }).hasAttribute('disabled')).toBe(true);
  });

  it('creates an MCS check log and shows saved logs', async () => {
    const syncMutate = vi.fn();
    const checkLogMutate = vi.fn();
    const profileMutate = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock
      .mockReturnValueOnce({
        isPending: false,
        mutate: syncMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: checkLogMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: profileMutate,
      });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: 'https://www.medical-care.net/patients/2463520',
          patientUrl: 'https://www.medical-care.net/patients/2463520',
          projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
          projectTitle: '田中一郎 在宅チーム',
          projectMemo: null,
          memberCount: 8,
          lastSyncAttemptAt: '2026-06-01T00:00:00.000Z',
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          lastSyncError: null,
        },
        profile: {
          linkedStatus: 'linked',
          participationStatus: 'joined',
          pharmacyParticipants: ['薬剤師 佐藤'],
          counterpartRoles: ['visiting_nurse'],
          lastCheckedAt: '2026-06-16T00:00:00.000Z',
          note: '毎朝確認',
          updatedAt: '2026-06-16T00:05:00.000Z',
        },
        summary: null,
        messages: [],
        checkLogs: [
          {
            id: 'mcs_log_1',
            subject: 'MCS 報告確認',
            content: '食欲低下の共有を確認',
            counterpartName: '田中一郎 在宅チーム',
            occurredAt: '2026-06-16T00:00:00.000Z',
            createdAt: '2026-06-16T00:01:00.000Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    expect(screen.getByText('食欲低下の共有を確認')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('要約'), {
      target: { value: '訪看からの転倒リスク共有を確認' },
    });
    fireEvent.change(screen.getByLabelText('次アクション'), {
      target: { value: '次回訪問でふらつきを確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認ログを登録' }));

    expect(checkLogMutate).toHaveBeenCalledWith({
      contentType: 'report',
      summary: '訪看からの転倒リスク共有を確認',
      nextAction: '次回訪問でふらつきを確認',
    });
    expect(syncMutate).not.toHaveBeenCalled();
    expect(profileMutate).not.toHaveBeenCalled();
  });

  it('updates the MCS participation profile from the profile panel', async () => {
    const syncMutate = vi.fn();
    const checkLogMutate = vi.fn();
    const profileMutate = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock
      .mockReturnValueOnce({
        isPending: false,
        mutate: syncMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: checkLogMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: profileMutate,
      });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: 'https://www.medical-care.net/patients/2463520',
          patientUrl: 'https://www.medical-care.net/patients/2463520',
          projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
          projectTitle: '田中一郎 在宅チーム',
          projectMemo: null,
          memberCount: 8,
          lastSyncAttemptAt: '2026-06-01T00:00:00.000Z',
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          lastSyncError: null,
        },
        profile: null,
        summary: null,
        messages: [],
        checkLogs: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('MCS連携'), {
      target: { value: 'linked' },
    });
    fireEvent.change(screen.getByLabelText('参加状況'), {
      target: { value: 'joined' },
    });
    fireEvent.change(screen.getByLabelText('薬局側参加者'), {
      target: { value: '薬剤師 佐藤\n事務 鈴木' },
    });
    fireEvent.click(screen.getByLabelText('訪問看護'));
    fireEvent.click(screen.getByLabelText('ケアマネ'));
    fireEvent.change(screen.getByLabelText('最終確認日時'), {
      target: { value: '2026-06-16T09:00' },
    });
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '訪問看護投稿を毎朝確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: '参加情報を保存' }));

    expect(profileMutate).toHaveBeenCalledWith({
      linkedStatus: 'linked',
      participationStatus: 'joined',
      pharmacyParticipants: ['薬剤師 佐藤', '事務 鈴木'],
      counterpartRoles: ['visiting_nurse', 'care_manager'],
      lastCheckedAt: expect.stringMatching(/^2026-06-16T/),
      note: '訪問看護投稿を毎朝確認',
    });
    expect(syncMutate).not.toHaveBeenCalled();
    expect(checkLogMutate).not.toHaveBeenCalled();
  });

  it('copies the MCS URL and supports one-click last-check updates', async () => {
    const syncMutate = vi.fn();
    const checkLogMutate = vi.fn();
    const profileMutate = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock
      .mockReturnValueOnce({
        isPending: false,
        mutate: syncMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: checkLogMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: profileMutate,
      });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: 'https://www.medical-care.net/patients/2463520',
          patientUrl: 'https://www.medical-care.net/patients/2463520',
          projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
          projectTitle: '田中一郎 在宅チーム',
          projectMemo: null,
          memberCount: 8,
          lastSyncAttemptAt: '2026-06-01T00:00:00.000Z',
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          lastSyncError: null,
        },
        profile: {
          linkedStatus: 'linked',
          participationStatus: 'joined',
          pharmacyParticipants: ['薬剤師 佐藤'],
          counterpartRoles: ['visiting_nurse'],
          lastCheckedAt: null,
          note: null,
          updatedAt: null,
        },
        summary: null,
        messages: [],
        checkLogs: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'https://www.medical-care.net/projects/medical/57886227',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '最終確認を今に更新' }));

    expect(profileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedStatus: 'linked',
        participationStatus: 'joined',
        pharmacyParticipants: ['薬剤師 佐藤'],
        counterpartRoles: ['visiting_nurse'],
        lastCheckedAt: expect.any(String),
      }),
    );
    expect(syncMutate).not.toHaveBeenCalled();
    expect(checkLogMutate).not.toHaveBeenCalled();
  });
});
