// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const workflowPageIntroMock = vi.hoisted(() => vi.fn());
const billingCandidatesContentMock = vi.hoisted(() => vi.fn());
const billingCandidatesContentMockState = vi.hoisted(() => ({
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

vi.mock('./billing-candidates-content', () => ({
  BillingCandidatesContent: (props: {
    initialBillingMonth?: string;
    initialPatientId?: string;
    initialCandidateId?: string;
    initialWorkflowFrom?: string;
    initialVisitRecordId?: string;
  }) => {
    billingCandidatesContentMock(props);
    if (billingCandidatesContentMockState.suspend) {
      throw billingCandidatesContentMockState.promise;
    }
    return <section data-testid="billing-candidates-content" />;
  },
}));

import BillingCandidatesPage from './page';

setupDomTestEnv();

describe('BillingCandidatesPage', () => {
  beforeEach(() => {
    workflowPageIntroMock.mockClear();
    billingCandidatesContentMock.mockClear();
    billingCandidatesContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await BillingCandidatesPage({
      searchParams: Promise.resolve({
        billing_month: '2026-07',
        patient_id: 'patient_1',
        candidate_id: 'candidate_1',
        workflow_from: 'visit',
        visit_record_id: 'visit_1',
      }),
    });
    return render(page);
  }

  it('renders the billing candidates workspace shell with search params', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: '月次請求候補' })).toBeTruthy();
    expect(screen.getByTestId('billing-candidates-content')).toBeTruthy();
    expect(billingCandidatesContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialBillingMonth: '2026-07',
        initialPatientId: 'patient_1',
        initialCandidateId: 'candidate_1',
        initialWorkflowFrom: 'visit',
        initialVisitRecordId: 'visit_1',
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    billingCandidatesContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('heading', { name: '月次請求候補' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '月次請求候補を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('billing-candidates-content')).toBeNull();
  });
});
