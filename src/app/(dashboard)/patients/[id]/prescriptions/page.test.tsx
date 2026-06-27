// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
import PatientPrescriptionsPage from './page';

setupDomTestEnv();

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientPrescriptionShortcutLinks: () => [],
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: ({ backHref }: { backHref?: string; children?: ReactNode }) => (
    <a href={backHref}>intro</a>
  ),
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

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

describe('PatientPrescriptionsPage', () => {
  it('prioritizes the MCS summary before the prescription brief', async () => {
    render(
      await PatientPrescriptionsPage({
        params: Promise.resolve({ id: 'patient_1' }),
      }),
    );

    const summary = screen.getByTestId('mcs-summary');
    const brief = screen.getByTestId('visit-brief');

    expect(summary.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('routes the patient back link through the shared patient href helper', async () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_patient_1__');

    render(
      await PatientPrescriptionsPage({
        params: Promise.resolve({ id: 'patient_1' }),
      }),
    );

    expect(buildPatientHref).toHaveBeenCalledWith('patient_1');
    expect(screen.getByRole('link', { name: 'intro' }).getAttribute('href')).toBe(
      '/patients/__helper_patient_1__',
    );
  });
});
