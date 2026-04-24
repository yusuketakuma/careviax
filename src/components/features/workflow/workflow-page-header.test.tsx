// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import Link from 'next/link';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { WorkflowPageHeader } from './workflow-page-header';

setupDomTestEnv();

describe('WorkflowPageHeader', () => {
  it('renders eyebrow, supporting content, action, and shortcut label in distinct groups', () => {
    render(
      <WorkflowPageHeader
        eyebrow="Patient Registry"
        title="患者一覧"
        description="患者の状況を一覧で確認します。"
        action={{ href: '/patients/new', label: '新規登録' }}
        supportingContent={<p>高リスクと同意不足を先に確認します。</p>}
        childrenLabel="関連導線"
        mainWorkflowSteps={['prescriptions']}
        mainWorkflowDescription="この画面は主業務フロー上の現在地を表示します。"
      >
        <Link href="/prescriptions">処方受付</Link>
      </WorkflowPageHeader>,
    );

    expect(screen.getByText('Patient Registry')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '患者一覧' })).toBeTruthy();
    expect(screen.queryByText('患者の状況を一覧で確認します。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '患者一覧の説明' }));
    expect(screen.getByText('患者の状況を一覧で確認します。')).toBeTruthy();
    expect(screen.getByText('高リスクと同意不足を先に確認します。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '新規登録' }).getAttribute('href')).toBe(
      '/patients/new',
    );
    expect(screen.getByText('関連導線')).toBeTruthy();
    expect(screen.getByRole('link', { name: '処方受付' }).getAttribute('href')).toBe(
      '/prescriptions',
    );
    expect(screen.getByTestId('main-workflow-compact-nav')).toBeTruthy();
    expect(screen.getByText('この画面は主業務フロー上の現在地を表示します。')).toBeTruthy();
  });
});
