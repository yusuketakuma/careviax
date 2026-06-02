// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ActionRail } from './action-rail';

setupDomTestEnv();

describe('ActionRail', () => {
  it('groups actions with configurable alignment', () => {
    render(
      <ActionRail align="between">
        <button type="button">戻る</button>
        <button type="button">保存</button>
      </ActionRail>,
    );

    expect(screen.getByRole('button', { name: '戻る' }).parentElement?.className).toContain(
      'justify-between',
    );
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });
});
