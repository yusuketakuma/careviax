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

    expect(section.className).toContain('rounded-md');
    expect(section.className).toContain('border-border/70');
    expect(section.className).toContain('bg-card');
    expect(section.className).toContain('overflow-visible');
    expect(section.className).not.toContain('rounded-xl');
    expect(section.className).not.toContain('shadow');
    expect(section.dataset.pageSection).toBe('true');
    expect(section.dataset.tone).toBe('default');
    expect(section.querySelector('[data-slot="page-section-header"]')?.className).toContain(
      'border-b',
    );
    expect(section.querySelector('[data-slot="page-section-content"]')?.className).toContain('p-4');
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

  it('owns selected emphasis and immersive mobile geometry as typed variants', () => {
    render(
      <PageSection title="現地記録" emphasis="selected" mobileSurface="bare">
        <p>本文</p>
      </PageSection>,
    );

    const section = screen.getByRole('region', { name: '現地記録' });
    expect(section.dataset.emphasis).toBe('selected');
    expect(section.dataset.mobileSurface).toBe('bare');
    expect(section.className).toContain('ring-2');
    expect(section.className).toContain('max-md:rounded-none');
    expect(section.className).toContain('max-md:border-0');
    expect(section.querySelector('[data-slot="page-section-content"]')?.className).toContain(
      'max-md:p-0',
    );
  });

  it('keeps warning and danger meaning in semantic tone variants', () => {
    const { rerender } = render(
      <PageSection title="要確認" tone="warning">
        <p>確認事項</p>
      </PageSection>,
    );

    let section = screen.getByRole('region', { name: '要確認' });
    expect(section.className).toContain('border-state-confirm/30');
    expect(section.className).toContain('bg-state-confirm/10');

    rerender(
      <PageSection title="中断" tone="danger">
        <p>続行できません</p>
      </PageSection>,
    );

    section = screen.getByRole('region', { name: '中断' });
    expect(section.className).toContain('border-destructive/30');
    expect(section.className).toContain('bg-destructive/5');
  });
});
