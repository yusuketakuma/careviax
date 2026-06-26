// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const adminPageHeaderMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: (props: { title: string; description: string; supportingContent?: unknown }) => {
    adminPageHeaderMock(props);
    return <h1>{props.title}</h1>;
  },
}));

vi.mock('./pca-pumps-content', () => ({
  PcaPumpsContent: () => <section data-testid="pca-pumps-content" />,
}));

import PcaPumpsPage from './page';

setupDomTestEnv();

describe('PcaPumpsPage', () => {
  it('keeps the PCA operations workspace ahead of the generic admin intro', () => {
    render(<PcaPumpsPage />);

    expect(screen.getByRole('heading', { name: 'PCAポンプレンタル' })).toBeTruthy();
    expect(screen.getByTestId('pca-pumps-content')).toBeTruthy();
    expect(adminPageHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
  });
});
