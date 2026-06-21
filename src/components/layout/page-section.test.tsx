// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PageSection } from './page-section';

setupDomTestEnv();

describe('PageSection', () => {
  it('renders a named section with description, actions, and content', () => {
    render(
      <PageSection
        title="現在の状況"
        description="件数サマリーを確認します。"
        actions={<button type="button">一括出力</button>}
      >
        <p>対象患者 10名</p>
      </PageSection>,
    );

    const section = screen.getByRole('region', { name: '現在の状況' });

    expect(section.className).toContain('rounded-xl');
    expect(section.className).toContain('border-border/70');
    expect(screen.getByText('件数サマリーを確認します。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '一括出力' })).toBeTruthy();
    expect(screen.getByText('対象患者 10名')).toBeTruthy();
  });

  it('supports an h3 heading level for nested groups', () => {
    render(
      <PageSection title="補助導線" headingLevel={3}>
        <p>お気に入り患者</p>
      </PageSection>,
    );

    expect(screen.getByRole('heading', { level: 3, name: '補助導線' })).toBeTruthy();
  });

  it('applies headerClassName to the heading row (p0_23 のモバイル見出し制御)', () => {
    render(
      <PageSection title="現地記録" headerClassName="max-md:hidden">
        <p>本文</p>
      </PageSection>,
    );

    const heading = screen.getByRole('heading', { name: '現地記録' });
    expect(heading.parentElement?.parentElement?.className).toContain('max-md:hidden');
  });
});
