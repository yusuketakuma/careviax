// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useSessionMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());
const signInMock = vi.hoisted(() => vi.fn());
const clearOfflineEncryptionKeyMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({
  useSession: useSessionMock,
  signOut: signOutMock,
  signIn: signInMock,
}));

vi.mock('@/lib/offline/crypto', () => ({
  clearOfflineEncryptionKey: clearOfflineEncryptionKeyMock,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span />,
  Clock: () => <span />,
  LogOut: () => <span />,
}));

import { SessionTimeoutModal } from './session-timeout-modal';

setupDomTestEnv();

describe('SessionTimeoutModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T00:00:00.000Z'));
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({
      data: { user: { email: 'pharmacist@example.test' } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start the 1-second countdown interval until the warning opens', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    render(<SessionTimeoutModal />);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'セッションタイムアウト' })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(25 * 60 * 1000);
    });

    expect(screen.getByRole('heading', { name: 'セッションタイムアウト' })).toBeTruthy();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });
});
