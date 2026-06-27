// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import MedicationsPage from './page';

setupDomTestEnv();

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientMedicationShortcutLinks: () => [],
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: ({
    actions,
    backHref,
    description,
    eyebrow,
    supportingContent,
  }: {
    actions?: ReactNode;
    backHref?: string;
    description?: ReactNode;
    eyebrow?: ReactNode;
    supportingContent?: ReactNode;
  }) => (
    <div data-testid="workflow-page-intro">
      <a href={backHref}>back</a>
      <p>{eyebrow}</p>
      <p>{description}</p>
      {supportingContent}
      <div data-testid="intro-actions">{actions}</div>
    </div>
  ),
}));

vi.mock('@/components/patient-mcs/patient-mcs-summary-section', () => ({
  PatientMcsSummarySection: () => <div data-testid="mcs-summary">mcs-summary</div>,
}));

vi.mock('@/components/visit-brief/patient-visit-brief-section', () => ({
  PatientVisitBriefSection: () => <div data-testid="visit-brief">visit-brief</div>,
}));

vi.mock('./medications-content', () => ({
  MedicationsContent: () => <div data-testid="medications-content">medications-content</div>,
}));

vi.mock('@/components/features/medications/intervention-panel', () => ({
  InterventionPanel: () => <div>intervention-panel</div>,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

describe('MedicationsPage', () => {
  it('prioritizes the medication workspace before supplemental summaries', async () => {
    render(
      await MedicationsPage({
        params: Promise.resolve({ id: 'patient_1' }),
      }),
    );

    const medications = screen.getByTestId('medications-content');
    const summary = screen.getByTestId('mcs-summary');
    const brief = screen.getByTestId('visit-brief');
    const intro = screen.getByTestId('workflow-page-intro');

    expect(
      intro.compareDocumentPosition(medications) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      medications.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      medications.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(summary.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps header actions large enough for clinical touch targets', async () => {
    render(
      await MedicationsPage({
        params: Promise.resolve({ id: 'patient_1' }),
      }),
    );

    expect(screen.getByText('服薬管理')).toBeTruthy();
    expect(screen.getByText('服薬中薬剤・課題・残薬を患者単位で確認します')).toBeTruthy();
    expect(
      screen.getByText(
        '服薬中薬剤と未解決課題を先に確認し、共有事項や残薬推移は後段で補足します。',
      ),
    ).toBeTruthy();
    // buttonVariants 共通化後も 44px タッチターゲット(min-h-11)を維持する。
    expect(screen.getByRole('link', { name: 'PDFを開く' }).className).toContain('min-h-11');
    expect(screen.getByRole('link', { name: '印刷ビュー' }).className).toContain('min-h-11');
  });

  it('routes patient back, PDF, and print links through shared path helpers', async () => {
    vi.mocked(buildPatientHref)
      .mockReturnValueOnce('/patients/__helper_patient_1__')
      .mockReturnValueOnce('/patients/__helper_patient_1__/medications/print');
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/medications/pdf',
    );

    render(
      await MedicationsPage({
        params: Promise.resolve({ id: 'patient_1' }),
      }),
    );

    expect(buildPatientHref).toHaveBeenNthCalledWith(1, 'patient_1');
    expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1', '/medications/pdf');
    expect(buildPatientHref).toHaveBeenNthCalledWith(2, 'patient_1', '/medications/print');
    expect(screen.getByRole('link', { name: 'back' }).getAttribute('href')).toBe(
      '/patients/__helper_patient_1__',
    );
    expect(screen.getByRole('link', { name: 'PDFを開く' }).getAttribute('href')).toBe(
      '/api/patients/__helper_patient_1__/medications/pdf',
    );
    expect(screen.getByRole('link', { name: '印刷ビュー' }).getAttribute('href')).toBe(
      '/patients/__helper_patient_1__/medications/print',
    );
  });
});
