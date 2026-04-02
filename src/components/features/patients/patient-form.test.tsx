// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientForm } from './patient-form';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const routerBackMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBackMock,
    push: routerPushMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PatientForm', () => {
  it('shows a label-only summary while keeping field-level error messages after an empty submit', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });

    render(<PatientForm />);

    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(screen.getByText('必須の4項目を入力してください')).toBeTruthy();
    });

    const summary = document.getElementById('patient-form-error-summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('氏名');
    expect(screen.queryByText('氏名：氏名は必須です')).toBeNull();
    expect(screen.getByText('氏名は必須です')).toBeTruthy();
    expect(screen.getByText('フリガナは必須です')).toBeTruthy();
  });
});
