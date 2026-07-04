// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import CommunicationRequestsPage from './page';

setupDomTestEnv();

const communicationRequestsContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

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
  Loading: ({ label = '読み込み中...' }: { label?: string }) => (
    <div role="status" aria-label={label}>
      {label}
    </div>
  ),
}));

vi.mock('./requests-content', () => ({
  CommunicationRequestsContent: ({
    initialRequestType,
  }: {
    initialRequestType?: string | null;
  }) => {
    if (communicationRequestsContentMockState.suspend) {
      throw communicationRequestsContentMockState.promise;
    }
    return (
      <section
        data-testid="communication-requests-content"
        data-request-type={initialRequestType ?? ''}
      >
        返信待ち・フォロー
      </section>
    );
  },
}));

describe('CommunicationRequestsPage', () => {
  beforeEach(() => {
    communicationRequestsContentMockState.suspend = false;
  });

  it('places the communication work queue before the collaboration workflow explainer', async () => {
    render(
      await CommunicationRequestsPage({
        searchParams: Promise.resolve({ request_type: 'care_report_reply_request' }),
      }),
    );

    const content = screen.getByTestId('communication-requests-content');
    const workflow = screen.getByTestId('collaboration-workflow-panel');
    expect(screen.getByText('コミュニケーション')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '依頼・照会一覧', level: 1 })).toBeTruthy();
    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    expect(content.getAttribute('data-request-type')).toBe('care_report_reply_request');
    expect(content.compareDocumentPosition(workflow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    communicationRequestsContentMockState.suspend = true;

    render(
      await CommunicationRequestsPage({
        searchParams: Promise.resolve({ request_type: 'care_report_reply_request' }),
      }),
    );

    expect(screen.getByRole('heading', { name: '依頼・照会一覧', level: 1 })).toBeTruthy();
    expect(screen.getByRole('status', { name: '依頼・照会一覧を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('communication-requests-content')).toBeNull();
  });
});
