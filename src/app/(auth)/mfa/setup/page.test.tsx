// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import MfaSetupPage from './page';

setupDomTestEnv();

const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('@/lib/auth/browser-auth-state', () => ({
  useSafeCallbackUrl: () => '/dashboard',
}));

describe('MfaSetupPage error message handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('falls back when MFA setup loading fails with an empty Error message', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('');
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MfaSetupPage />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'MFA設定情報の取得に失敗しました',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/me/mfa/setup', { method: 'POST' });
  });

  it('falls back when MFA verification fails with an empty Error message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            secretCode: 'MFA-SECRET',
            otpauthUri: 'otpauth://totp/ph-os:test@example.com?secret=MFASECRET',
          }),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new Error(''));
    vi.stubGlobal('fetch', fetchMock);

    render(<MfaSetupPage />);

    await screen.findByText('MFA-SECRET');
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));

    for (let index = 0; index < 6; index += 1) {
      fireEvent.change(screen.getByLabelText(`コード ${index + 1}桁目`), {
        target: { value: String(index + 1) },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: '確認する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/me/mfa/verify',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      '確認コードが正しくありません。もう一度お試しください。',
    );
  });
});
