// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrintPageToolbar } from './print-page-toolbar';

setupDomTestEnv();

describe('PrintPageToolbar', () => {
  it('renders the shared print toolbar with back link, shortcuts, and print button', () => {
    render(
      <PrintPageToolbar
        backHref="/reports/abc"
        backLabel="報告書詳細へ戻る"
        title="報告書 印刷ビュー"
        description="A4 印刷用"
        mainWorkflowSteps={['reports']}
        shortcuts={[
          { href: '/reports', label: '報告書一覧' },
          { href: '/external', label: '外部連携' },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: '報告書詳細へ戻る' }).getAttribute('href')).toBe(
      '/reports/abc',
    );
    expect(screen.getByRole('heading', { name: '報告書 印刷ビュー' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '印刷' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '報告書一覧' }).getAttribute('href')).toBe('/reports');
    expect(screen.getByTestId('main-workflow-compact-nav')).toBeTruthy();
  });
});
