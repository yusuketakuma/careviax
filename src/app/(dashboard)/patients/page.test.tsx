// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import PatientsPage from './page';

setupDomTestEnv();

const patientsTableMock = vi.hoisted(() => vi.fn(() => <div>patients-table</div>));

vi.mock('./patients-table', () => ({
  PatientsTable: patientsTableMock,
}));

vi.mock('./patients-board', () => ({
  PatientsBoard: () => <div data-testid="patients-board">patients-board</div>,
}));

vi.mock('@/components/ui/loading', () => ({
  Loading: () => <div>loading</div>,
}));

vi.mock('@/components/features/workflow/page-shortcut-links', () => ({
  PageShortcutLinks: () => <div>links</div>,
}));

vi.mock('@/components/features/workflow/workflow-page-header', () => ({
  WorkflowPageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('PatientsPage', () => {
  it('passes URL search params into the patients table initial filters', async () => {
    render(
      await PatientsPage({
        searchParams: Promise.resolve({
          q: '山田',
          case_status: 'active,assessment',
          consent_status: 'missing',
          readiness_issue: 'missing_primary_physician',
        }),
      })
    );

    // new_02_patient_list: カード一覧が先頭、旧テーブル一覧は下部に温存
    const board = screen.getByTestId('patients-board');
    const legacyTable = screen.getByText('patients-table');
    expect(
      board.compareDocumentPosition(legacyTable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByText('patients-table')).toBeTruthy();
    expect(patientsTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFilters: expect.objectContaining({
          searchQuery: '山田',
          caseStatusFilters: ['active', 'assessment'],
          consentFilter: 'missing',
          readinessIssueFilter: 'missing_primary_physician',
        }),
      }),
      undefined
    );
  });
});
