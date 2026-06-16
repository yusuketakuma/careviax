// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { WorkflowPageIntro } from './workflow-page-intro';

setupDomTestEnv();

describe('WorkflowPageIntro', () => {
  it('renders the back link, shortcuts, and optional actions in one compact block', () => {
    render(
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        eyebrow="Patient Hub"
        title="患者詳細"
        description="基本情報と関連作業を確認します。"
        supportingContent={<p>ケース確認後に服薬・共有を確認します。</p>}
        shortcuts={[
          { href: '/patients/p1/prescriptions', label: '処方履歴' },
          { href: '/patients/p1/medications', label: '服薬管理' },
        ]}
        actions={<button type="button">印刷</button>}
      />,
    );

    expect(screen.getByRole('link', { name: '患者一覧へ戻る' }).getAttribute('href')).toBe(
      '/patients',
    );
    expect(screen.getByText('Patient Hub')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '患者詳細' })).toBeTruthy();
    expect(screen.getByText('ケース確認後に服薬・共有を確認します。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '処方履歴' }).getAttribute('href')).toBe(
      '/patients/p1/prescriptions',
    );
    expect(screen.getByRole('button', { name: '印刷' })).toBeTruthy();
  });

  it('accepts mixed controls for pages that need custom right-rail composition', () => {
    render(
      <WorkflowPageIntro
        backHref="/reports"
        backLabel="報告書一覧へ戻る"
        title="報告書 印刷ビュー"
        description="印刷向けに整形した出力です。"
        controls={
          <>
            <button type="button">印刷</button>
            <a href="/external">外部連携</a>
          </>
        }
      />,
    );

    expect(screen.getByRole('button', { name: '印刷' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '外部連携' }).getAttribute('href')).toBe('/external');
  });

  it('renders grouped shortcut headings when shortcut metadata includes groups', () => {
    render(
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        title="患者詳細"
        description="患者の関連導線をまとめて確認します。"
        shortcuts={[
          { href: '/patients/p1/prescriptions', label: '処方履歴', group: '服薬・経過' },
          { href: '/patients/p1/share', label: '外部共有', group: '連携・共有' },
        ]}
      />,
    );

    expect(screen.getByText('服薬・経過')).toBeTruthy();
    expect(screen.getByText('連携・共有')).toBeTruthy();
    expect(screen.getByRole('link', { name: '処方履歴' }).getAttribute('href')).toBe(
      '/patients/p1/prescriptions',
    );
    expect(screen.getByRole('link', { name: '外部共有' }).getAttribute('href')).toBe(
      '/patients/p1/share',
    );
  });

  it('can render the compact main workflow navigator below the header', () => {
    render(
      <WorkflowPageIntro
        backHref="/dispense"
        backLabel="調剤へ戻る"
        title="調剤"
        description="調剤ワークベンチです。"
        mainWorkflowSteps={['dispensing']}
        mainWorkflowDescription="ワークベンチでも、主業務フローの現在地を固定表示します。"
      />,
    );

    expect(screen.getByTestId('main-workflow-compact-nav')).toBeTruthy();
    expect(screen.getByText('主業務フロー上の現在地')).toBeTruthy();
    expect(
      screen.getByText('ワークベンチでも、主業務フローの現在地を固定表示します。'),
    ).toBeTruthy();
    const workflowNav = screen.getByTestId('main-workflow-compact-nav');
    expect(
      Array.from(workflowNav.querySelectorAll('ol span')).filter(
        (element) => element.textContent === '現在地',
      ),
    ).toHaveLength(1);
  });
});
