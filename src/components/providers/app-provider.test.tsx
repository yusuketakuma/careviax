// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { useAuthStore } from '@/lib/stores/auth-store';

const {
  sessionProviderMock,
  useSessionMock,
  initOfflineEncryptionKeyMock,
  clearOfflineEncryptionKeyMock,
} = vi.hoisted(() => ({
  sessionProviderMock: vi.fn(),
  useSessionMock: vi.fn(),
  initOfflineEncryptionKeyMock: vi.fn(),
  clearOfflineEncryptionKeyMock: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  SessionProvider: ({
    children,
    session,
  }: {
    children: React.ReactNode;
    session: Session | null;
  }) => {
    sessionProviderMock(session);
    return <>{children}</>;
  },
  useSession: useSessionMock,
}));

vi.mock('@/lib/offline/crypto', () => ({
  initOfflineEncryptionKey: initOfflineEncryptionKeyMock,
  clearOfflineEncryptionKey: clearOfflineEncryptionKeyMock,
}));

import { AppProvider } from './app-provider';

describe('AppProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().resetAuth();
  });

  it('initializes the offline encryption key from the Cognito identity', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user_1',
          email: 'staff@example.com',
          name: '薬剤師',
          cognitoSub: 'sub_123',
        },
        offlineEncryptionSecret: 'offline-secret',
      },
    });

    render(
      <AppProvider session={null} initialOrgId="org_1" initialSiteId="site_1">
        <div>child</div>
      </AppProvider>,
    );

    await waitFor(() => {
      expect(initOfflineEncryptionKeyMock).toHaveBeenCalledWith('sub_123', 'offline-secret');
    });
    expect(clearOfflineEncryptionKeyMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().currentUser).toMatchObject({
      id: 'user_1',
      email: 'staff@example.com',
      name: '薬剤師',
      cognitoSub: 'sub_123',
    });
  });

  it('clears the offline encryption key when the session lacks an offline encryption secret', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user_1',
          email: 'staff@example.com',
          name: '薬剤師',
          cognitoSub: 'sub_123',
        },
      },
    });

    render(
      <AppProvider session={null} initialOrgId="org_1" initialSiteId="site_1">
        <div>child</div>
      </AppProvider>,
    );

    await waitFor(() => {
      expect(clearOfflineEncryptionKeyMock).toHaveBeenCalledTimes(1);
    });
    expect(initOfflineEncryptionKeyMock).not.toHaveBeenCalled();
  });

  it('clears the offline encryption key when there is no authenticated session', async () => {
    useSessionMock.mockReturnValue({
      status: 'unauthenticated',
      data: null,
    });

    render(
      <AppProvider session={null} initialOrgId="org_1" initialSiteId="site_1">
        <div>child</div>
      </AppProvider>,
    );

    await waitFor(() => {
      expect(clearOfflineEncryptionKeyMock).toHaveBeenCalledTimes(1);
    });
    expect(initOfflineEncryptionKeyMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().currentUser).toMatchObject({
      id: null,
      email: null,
      name: null,
      cognitoSub: null,
    });
  });
});
