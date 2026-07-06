// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import LoginPage from './page';

const { signInMock, searchParamsRef } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsRef.current,
}));

setupDomTestEnv();

describe('LoginPage', () => {
  beforeEach(() => {
    signInMock.mockReset();
    searchParamsRef.current = new URLSearchParams();
    window.sessionStorage.clear();
  });

  it('keeps the login surface minimal and staff-focused', () => {
    render(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeTruthy();
    expect(screen.getByText('職員ログイン')).toBeTruthy();
    expect(screen.getByText('MFA / 監査ログ / セッション保護')).toBeTruthy();
    expect(screen.getByLabelText('メールアドレス').getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('パスワード').getAttribute('autocomplete')).toBe(
      'current-password',
    );
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '忘れた方' }).getAttribute('href')).toBe(
      '/password/reset',
    );
    expect(
      screen.getByText('共有端末では、画面を離れる前に必ずログアウトしてください。'),
    ).toBeTruthy();
  });

  it('does not pass an external callbackUrl to credentials sign-in', async () => {
    signInMock.mockResolvedValue({ url: null });
    searchParamsRef.current = new URLSearchParams('callbackUrl=https%3A%2F%2Fevil.example');

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.jp' },
    });
    fireEvent.change(screen.getByLabelText('パスワード'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        email: 'staff@example.jp',
        password: 'correct horse battery staple',
        mode: 'password',
        redirect: false,
        callbackUrl: '/dashboard',
      });
    });
  });

  it('rejects protocol-relative callbackUrl values before credentials sign-in', async () => {
    signInMock.mockResolvedValue({ url: null });
    searchParamsRef.current = new URLSearchParams('callbackUrl=%2F%2Fevil.example%2Fphish');

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.jp' },
    });
    fireEvent.change(screen.getByLabelText('パスワード'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(
        'credentials',
        expect.objectContaining({ callbackUrl: '/dashboard' }),
      );
    });
  });

  it('allows password visibility to be toggled without changing the submitted password', async () => {
    signInMock.mockResolvedValue({ url: null });
    render(<LoginPage />);

    const passwordInput = screen.getByLabelText('パスワード');
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.jp' },
    });
    fireEvent.change(passwordInput, {
      target: { value: 'PhOsDemo-2026' },
    });

    expect(passwordInput.getAttribute('type')).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを表示' }));
    expect(signInMock).not.toHaveBeenCalled();
    expect(passwordInput.getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを隠す' }));
    expect(passwordInput.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(
        'credentials',
        expect.objectContaining({ password: 'PhOsDemo-2026' }),
      );
    });
  });
});
