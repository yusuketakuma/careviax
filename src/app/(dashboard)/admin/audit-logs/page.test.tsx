// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const auditLogsContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: (props: {
    title: string;
    description: string;
    shortcuts: Array<{ href: string; label: string }>;
    supportingContent?: unknown;
  }) => {
    adminPageHeaderMock(props);
    return <h1>{props.title}</h1>;
  },
}));

vi.mock('@/components/features/admin/admin-page-shortcut-presets', () => ({
  getAdminAuditLogsShortcutLinks: () => [{ href: '/admin/metrics', label: '経営指標' }],
}));

vi.mock('./audit-logs-content', () => ({
  AuditLogsContent: () => {
    if (auditLogsContentMockState.suspend) {
      throw auditLogsContentMockState.promise;
    }
    return <section data-testid="audit-logs-content" />;
  },
}));

import AuditLogsPage from './page';

setupDomTestEnv();

describe('AuditLogsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    auditLogsContentMockState.suspend = false;
  });

  it('renders the audit logs workspace shell', () => {
    render(<AuditLogsPage />);

    expect(screen.getByRole('heading', { name: '監査ログ' })).toBeTruthy();
    expect(screen.getByTestId('audit-logs-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/metrics', label: '経営指標' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    auditLogsContentMockState.suspend = true;

    render(<AuditLogsPage />);

    expect(screen.getByRole('heading', { name: '監査ログ' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '監査ログを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('audit-logs-content')).toBeNull();
  });
});
