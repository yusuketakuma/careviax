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
    expect(screen.getByRole('tab', { name: '基本' }).getAttribute('data-active')).not.toBeNull();
    expect(screen.getByRole('tab', { name: '住所・保険' }).getAttribute('data-active')).toBeNull();
    expect(screen.queryByText('氏名：氏名は必須です')).toBeNull();
    expect(screen.getByText('氏名は必須です')).toBeTruthy();
    expect(screen.getByText('フリガナは必須です')).toBeTruthy();
  });

  it('groups edit fields into compact information tabs', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: [], isLoading: false });

    render(<PatientForm />);

    expect(screen.getByRole('tab', { name: '基本' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '住所・保険' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '依頼元' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '訪問' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '生活・薬学' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '連携' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '住所・保険' }));

    expect(screen.getByText('連絡先・保険情報')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '生活・薬学' }));

    expect(screen.getByText('生活背景')).toBeTruthy();
    expect(screen.getByText('算定前提')).toBeTruthy();
    expect(screen.getByText('服薬支援')).toBeTruthy();
    expect(screen.getByText('医療処置')).toBeTruthy();
    expect(screen.getByLabelText('単一建物の医療患者数')).toBeTruthy();
    expect(screen.queryByText('在宅薬学総合体制加算2 関連確認')).toBeNull();
    expect(screen.queryByText('根拠確認日')).toBeNull();
    expect(screen.queryByText('レセプト摘要・確認メモ')).toBeNull();
  });
});
