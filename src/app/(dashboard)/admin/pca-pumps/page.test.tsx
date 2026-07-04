// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const pcaPumpsContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: (props: { title: string; description: string; supportingContent?: unknown }) => {
    adminPageHeaderMock(props);
    return <h1>{props.title}</h1>;
  },
}));

vi.mock('./pca-pumps-content', () => ({
  PcaPumpsContent: () => {
    if (pcaPumpsContentMockState.suspend) {
      throw pcaPumpsContentMockState.promise;
    }
    return <section data-testid="pca-pumps-content" />;
  },
}));

import PcaPumpsPage from './page';

setupDomTestEnv();

describe('PcaPumpsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    pcaPumpsContentMockState.suspend = false;
  });

  it('keeps the PCA operations workspace ahead of the generic admin intro', () => {
    render(<PcaPumpsPage />);

    expect(screen.getByRole('heading', { name: 'PCAポンプレンタル' })).toBeTruthy();
    expect(screen.getByTestId('pca-pumps-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    pcaPumpsContentMockState.suspend = true;

    render(<PcaPumpsPage />);

    expect(screen.getByRole('heading', { name: 'PCAポンプレンタル' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'PCAポンプレンタルを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('pca-pumps-content')).toBeNull();
  });
});
