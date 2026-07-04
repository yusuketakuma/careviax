// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());
const externalProfessionalsContentMockState = vi.hoisted(() => ({
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
  getAdminExternalProfessionalsShortcutLinks: () => [
    { href: '/admin/contact-profiles', label: '連携先プロファイル' },
  ],
}));

vi.mock('./external-professionals-content', () => ({
  ExternalProfessionalsContent: () => {
    if (externalProfessionalsContentMockState.suspend) {
      throw externalProfessionalsContentMockState.promise;
    }
    return <section data-testid="external-professionals-content" />;
  },
}));

import ExternalProfessionalsPage from './page';

setupDomTestEnv();

describe('ExternalProfessionalsPage', () => {
  beforeEach(() => {
    adminPageHeaderMock.mockClear();
    externalProfessionalsContentMockState.suspend = false;
  });

  it('renders the external professionals workspace shell', () => {
    render(<ExternalProfessionalsPage />);

    expect(screen.getByRole('heading', { name: '他職種マスター' })).toBeTruthy();
    expect(screen.getByTestId('external-professionals-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supportingContent: null,
        shortcuts: [{ href: '/admin/contact-profiles', label: '連携先プロファイル' }],
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    externalProfessionalsContentMockState.suspend = true;

    render(<ExternalProfessionalsPage />);

    expect(screen.getByRole('heading', { name: '他職種マスター' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '他職種マスターを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('external-professionals-content')).toBeNull();
  });
});
