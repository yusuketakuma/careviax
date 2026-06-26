// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import CommunicationRequestsPage from './page';

setupDomTestEnv();

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="page-scaffold-stack">{children}</main>
  ),
}));

vi.mock('@/components/features/workflow/workflow-page-header', () => ({
  WorkflowPageHeader: ({
    eyebrow,
    title,
    supportingContent,
    children,
  }: {
    eyebrow?: string;
    title: string;
    supportingContent?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <header>
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      {supportingContent}
      {children}
    </header>
  ),
}));

vi.mock('@/components/features/workflow/page-shortcut-links', () => ({
  PageShortcutLinks: () => <nav aria-label="関連導線">関連導線</nav>,
}));

vi.mock('@/components/features/workflow/collaboration-workflow-panel', () => ({
  CollaborationWorkflowPanel: () => (
    <section data-testid="collaboration-workflow-panel">他職種連携の接続点</section>
  ),
}));

vi.mock('@/components/ui/loading', () => ({
  Loading: () => <div role="status">loading</div>,
}));

vi.mock('./requests-content', () => ({
  CommunicationRequestsContent: () => (
    <section data-testid="communication-requests-content">返信待ち・フォロー</section>
  ),
}));

describe('CommunicationRequestsPage', () => {
  it('places the communication work queue before the collaboration workflow explainer', async () => {
    render(await CommunicationRequestsPage({ searchParams: Promise.resolve({}) }));

    const content = screen.getByTestId('communication-requests-content');
    const workflow = screen.getByTestId('collaboration-workflow-panel');
    expect(screen.getByText('コミュニケーション')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '依頼・照会一覧', level: 1 })).toBeTruthy();
    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    expect(content.compareDocumentPosition(workflow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
