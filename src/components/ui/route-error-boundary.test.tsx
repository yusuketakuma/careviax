// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const clientLogErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { error: clientLogErrorMock },
}));

import PlatformError from '@/app/platform/error';
import AdminError from '@/app/(dashboard)/admin/error';
import { createRouteErrorBoundary } from './route-error-boundary';

setupDomTestEnv();

afterEach(() => {
  clientLogErrorMock.mockReset();
});

describe('createRouteErrorBoundary', () => {
  it('keeps the dashboard recovery action by default', () => {
    const DefaultRouteError = createRouteErrorBoundary('DefaultRouteError');

    render(<DefaultRouteError error={new Error('synthetic detail')} reset={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'ダッシュボードへ戻る' }).getAttribute('href')).toBe(
      '/dashboard',
    );
  });

  it('uses the platform console as the recovery target without rendering raw error detail', () => {
    const reset = vi.fn();
    const rawDetail = 'synthetic-platform-error-detail-token=secret';
    const error = Object.assign(new Error(rawDetail), { digest: 'platform-error-digest' });

    render(<PlatformError error={error} reset={reset} />);

    expect(
      screen.getByRole('link', { name: 'プラットフォームコンソールへ戻る' }).getAttribute('href'),
    ).toBe('/platform');
    expect(screen.queryByText(rawDetail)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(clientLogErrorMock).toHaveBeenCalledWith('route_error_boundary', error, {
      code: 'platform-error-digest',
      route: 'PlatformError',
    });
  });

  it('keeps admin failures within the dashboard recovery boundary without rendering raw detail', () => {
    const reset = vi.fn();
    const rawDetail = 'synthetic-admin-error-detail-token=secret';
    const error = Object.assign(new Error(rawDetail), { digest: 'admin-error-digest' });

    render(<AdminError error={error} reset={reset} />);

    expect(screen.getByRole('link', { name: 'ダッシュボードへ戻る' }).getAttribute('href')).toBe(
      '/dashboard',
    );
    expect(screen.queryByText(rawDetail)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(clientLogErrorMock).toHaveBeenCalledWith('route_error_boundary', error, {
      code: 'admin-error-digest',
      route: 'AdminError',
    });
  });
});
