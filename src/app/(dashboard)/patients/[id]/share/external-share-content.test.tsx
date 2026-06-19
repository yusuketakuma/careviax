// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

import { ExternalShareContent } from './external-share-content';

setupDomTestEnv();

describe('ExternalShareContent', () => {
  it('renders share setup and history with semantic section headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        external_shares: [
          {
            id: 'share_1',
            granted_to_name: '田中ケアマネジャー',
            expires_at: '2026-06-03T00:00:00.000Z',
            accessed_at: null,
          },
        ],
        self_reports: [
          {
            id: 'report_1',
            subject: '疼痛の相談',
            created_at: '2026-06-01T00:00:00.000Z',
            status: 'open',
          },
        ],
      },
      isLoading: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '共有設定' }).tagName).toBe('H2');
    expect(
      screen.getByRole('heading', { level: 2, name: '共有済みリンクと連絡文脈' }).tagName,
    ).toBe('H2');
    expect(screen.getByRole('button', { name: /共有リンクを発行/ })).toBeTruthy();
    expect(screen.getByText('田中ケアマネジャー')).toBeTruthy();
    expect(screen.getByText('疼痛の相談')).toBeTruthy();
  });

  it('keeps share setup validation errors visible inline', () => {
    const mutate = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate, isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        external_shares: [],
        self_reports: [],
      },
      isLoading: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const submitButton = screen.getByRole('button', { name: /共有リンクを発行/ });
    const nameInput = screen.getByLabelText('共有先氏名');

    fireEvent.click(submitButton);

    expect(screen.getByRole('alert').textContent).toBe('共有先氏名は必須です');
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: '田中ケアマネジャー' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /服薬情報/ }));
    fireEvent.click(submitButton);

    expect(screen.getByRole('alert').textContent).toBe('共有する情報を1つ以上選択してください');
    expect(
      screen.getByRole('group', { name: '共有する情報' }).getAttribute('aria-describedby'),
    ).toBe('share-scope-error');
    expect(mutate).not.toHaveBeenCalled();
  });
});
