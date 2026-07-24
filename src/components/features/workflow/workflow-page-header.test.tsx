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
    expect(screen.getByTestId('page-purpose').textContent).toContain('患者の状況を一覧で確認します。');
    fireEvent.click(screen.getByRole('button', { name: '患者一覧の説明' }));
    expect(screen.getAllByText('患者の状況を一覧で確認します。')).toHaveLength(2);
    expect(screen.getByRole('group', { name: '主要操作' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '補助情報' })).toBeTruthy();
    expect(screen.getByText('高リスクと同意不足を先に確認します。')).toBeTruthy();
    const primaryAction = screen.getByRole('link', { name: '新規登録' });
    expect(primaryAction.getAttribute('href')).toBe('/patients/new');
    expect(primaryAction.className).toContain('min-h-11');
    expect(primaryAction.className).toContain('rounded-lg');
    expect(primaryAction.className).not.toContain('shadow');
    expect(primaryAction.className).not.toContain('rounded-xl');
    expect(primaryAction.className).not.toContain('sm:h-10');
    expect(screen.getByText('関連導線')).toBeTruthy();
    expect(screen.getByRole('link', { name: '処方受付' }).getAttribute('href')).toBe(
      '/prescriptions',
    );
    expect(screen.getByTestId('main-workflow-compact-nav')).toBeTruthy();
    expect(screen.getByText('この画面は主業務フロー上の現在地を表示します。')).toBeTruthy();
    expect(document.querySelectorAll('[data-page-header="true"]')).toHaveLength(1);
  });
});
