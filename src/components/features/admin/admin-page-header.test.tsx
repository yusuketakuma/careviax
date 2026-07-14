// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AdminPageHeader } from './admin-page-header';

setupDomTestEnv();

describe('AdminPageHeader', () => {
  it('composes the same page frame and context bar without nested page-header markers', () => {
    render(
      <AdminPageHeader
        title="施設マスター"
        description="施設情報を管理します。"
        shortcuts={[{ href: '/admin/settings', label: '設定' }]}
        supportingContent={null}
      />,
    );

    expect(screen.getByRole('heading', { name: '施設マスター' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'マスターへ戻る' }).getAttribute('href')).toBe(
      '/admin',
    );
    expect(screen.getByRole('link', { name: '設定' }).getAttribute('href')).toBe('/admin/settings');
    expect(document.querySelectorAll('[data-page-header="true"]')).toHaveLength(1);
    expect(document.querySelector('[data-page-context-bar="true"]')).toBeTruthy();
  });
});
