// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import PatientPrescriptionsPage from './page';

setupDomTestEnv();

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientPrescriptionShortcutLinks: () => [],
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: () => <div>intro</div>,
}));

vi.mock('@/components/patient-mcs/patient-mcs-summary-section', () => ({
  PatientMcsSummarySection: () => <div data-testid="mcs-summary">mcs-summary</div>,
}));

vi.mock('@/components/visit-brief/patient-visit-brief-section', () => ({
  PatientVisitBriefSection: () => <div data-testid="visit-brief">visit-brief</div>,
}));

vi.mock('./prescription-history-content', () => ({
  PrescriptionHistoryContent: () => <div>history</div>,
}));

describe('PatientPrescriptionsPage', () => {
  it('prioritizes the MCS summary before the prescription brief', async () => {
    render(
      await PatientPrescriptionsPage({
        params: Promise.resolve({ id: 'patient_1' }),
      })
    );

    const summary = screen.getByTestId('mcs-summary');
    const brief = screen.getByTestId('visit-brief');

    expect(
      summary.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
