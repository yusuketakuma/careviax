// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const workflowPageIntroMock = vi.hoisted(() => vi.fn());
const partnerCooperationBillingContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: (props: {
    backHref: string;
    backLabel: string;
    title: string;
    description: string;
    supportingContent?: unknown;
    shortcuts: Array<{ href: string; label: string }>;
  }) => {
    workflowPageIntroMock(props);
    return <h1>{props.title}</h1>;
  },
}));

vi.mock('./partner-cooperation-billing-content', () => ({
  PartnerCooperationBillingContent: () => {
    if (partnerCooperationBillingContentMockState.suspend) {
      throw partnerCooperationBillingContentMockState.promise;
    }
    return <section data-testid="partner-cooperation-billing-content" />;
  },
}));

import PartnerCooperationBillingPage from './page';

setupDomTestEnv();

describe('PartnerCooperationBillingPage', () => {
  beforeEach(() => {
    workflowPageIntroMock.mockClear();
    partnerCooperationBillingContentMockState.suspend = false;
  });

  it('renders the partner cooperation billing workspace shell', () => {
    render(<PartnerCooperationBillingPage />);

    expect(screen.getByRole('heading', { name: '薬局間協力 月次処理' })).toBeTruthy();
    expect(screen.getByTestId('partner-cooperation-billing-content')).toBeTruthy();
    expect(workflowPageIntroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backHref: '/billing',
        shortcuts: expect.arrayContaining([{ href: '/billing/candidates', label: '通常請求候補' }]),
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    partnerCooperationBillingContentMockState.suspend = true;

    render(<PartnerCooperationBillingPage />);

    expect(screen.getByRole('heading', { name: '薬局間協力 月次処理' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '薬局間協力 月次処理を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('partner-cooperation-billing-content')).toBeNull();
  });
});
