// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const pharmacyCooperationWorkflowContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./pharmacy-cooperation-workflow-content', () => ({
  PharmacyCooperationWorkflowContent: () => {
    if (pharmacyCooperationWorkflowContentMockState.suspend) {
      throw pharmacyCooperationWorkflowContentMockState.promise;
    }
    return <section data-testid="pharmacy-cooperation-workflow-content" />;
  },
}));

import PharmacyCooperationWorkflowPage from './page';

setupDomTestEnv();

describe('PharmacyCooperationWorkflowPage', () => {
  beforeEach(() => {
    pharmacyCooperationWorkflowContentMockState.suspend = false;
  });

  it('renders the pharmacy cooperation workflow shell', () => {
    render(<PharmacyCooperationWorkflowPage />);

    expect(screen.getByRole('heading', { name: '薬局間協力ワークフロー' })).toBeTruthy();
    expect(screen.getByTestId('pharmacy-cooperation-workflow-content')).toBeTruthy();
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    pharmacyCooperationWorkflowContentMockState.suspend = true;

    render(<PharmacyCooperationWorkflowPage />);

    expect(screen.getByRole('heading', { name: '薬局間協力ワークフロー' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: '薬局間協力ワークフローを読み込み中...' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('pharmacy-cooperation-workflow-content')).toBeNull();
  });
});
