// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const billingCheckContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./billing-check-content', () => ({
  BillingCheckContent: () => {
    if (billingCheckContentMockState.suspend) {
      throw billingCheckContentMockState.promise;
    }
    return <section data-testid="billing-check-content" />;
  },
}));

import BillingPage from './page';

setupDomTestEnv();

describe('BillingPage', () => {
  beforeEach(() => {
    billingCheckContentMockState.suspend = false;
  });

  it('renders the billing check content shell', () => {
    render(<BillingPage />);

    expect(screen.getByTestId('billing-check-content')).toBeTruthy();
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    billingCheckContentMockState.suspend = true;

    render(<BillingPage />);

    expect(screen.getByRole('status', { name: '算定チェックを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('billing-check-content')).toBeNull();
  });
});
