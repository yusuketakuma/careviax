// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import MedicationsPage from './page';

setupDomTestEnv();

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientMedicationShortcutLinks: () => [],
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

vi.mock('./medications-content', () => ({
  MedicationsContent: () => <div>medications-content</div>,
}));

vi.mock('@/components/features/medications/intervention-panel', () => ({
  InterventionPanel: () => <div>intervention-panel</div>,
}));

describe('MedicationsPage', () => {
  it('prioritizes the MCS summary before the visit brief', async () => {
    render(
      await MedicationsPage({
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
