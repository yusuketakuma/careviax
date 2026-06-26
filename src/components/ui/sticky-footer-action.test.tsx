// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { StickyFooterAction } from '@/components/ui/sticky-footer-action';

setupDomTestEnv();

describe('StickyFooterAction', () => {
  it('renders actions inside a labelled, sticky region', () => {
    render(
      <StickyFooterAction>
        <button type="button">保存</button>
      </StickyFooterAction>,
    );
    const region = screen.getByRole('region', { name: '操作' });
    expect(region.className).toContain('sticky');
    expect(region.className).toContain('bottom-0');
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('renders an optional status slot alongside the actions', () => {
    render(
      <StickyFooterAction status="未保存の変更があります">
        <button type="button">確定</button>
      </StickyFooterAction>,
    );
    expect(screen.getByText('未保存の変更があります')).toBeTruthy();
    expect(screen.getByRole('button', { name: '確定' })).toBeTruthy();
  });

  it('accepts a custom aria-label', () => {
    render(
      <StickyFooterAction aria-label="フォーム操作">
        <button type="button">送信</button>
      </StickyFooterAction>,
    );
    expect(screen.getByRole('region', { name: 'フォーム操作' })).toBeTruthy();
  });
});
