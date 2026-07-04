// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const operationalPolicyContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./operational-policy-content', () => ({
  OperationalPolicyContent: () => {
    if (operationalPolicyContentMockState.suspend) {
      throw operationalPolicyContentMockState.promise;
    }
    return <section data-testid="operational-policy-content" />;
  },
}));

import SettingsPage from './page';

setupDomTestEnv();

describe('SettingsPage', () => {
  beforeEach(() => {
    operationalPolicyContentMockState.suspend = false;
  });

  it('renders operational policy content', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('operational-policy-content')).toBeTruthy();
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    operationalPolicyContentMockState.suspend = true;

    render(<SettingsPage />);

    expect(screen.getByRole('status', { name: '設定を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('operational-policy-content')).toBeNull();
  });
});
