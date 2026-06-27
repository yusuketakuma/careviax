// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import MedicationsPage from './page';

setupDomTestEnv();

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientMedicationShortcutLinks: () => [],
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: ({
    actions,
    description,
    eyebrow,
    supportingContent,
  }: {
    actions?: ReactNode;
    description?: ReactNode;
    eyebrow?: ReactNode;
    supportingContent?: ReactNode;
  }) => (
    <div data-testid="workflow-page-intro">
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
});
