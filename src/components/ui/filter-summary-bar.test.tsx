// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { FilterSummaryBar } from './filter-summary-bar';

setupDomTestEnv();

describe('FilterSummaryBar', () => {
  it('renders summary badges and optional actions', () => {
    render(
      <FilterSummaryBar
        items={[
          { label: '適用中フィルタ', value: '2件' },
          { label: '同意不足', value: '1名', tone: 'warning' },
        ]}
        actions={<button type="button">解除</button>}
      />,
    );

    expect(screen.getByText('適用中フィルタ 2件')).toBeTruthy();
    expect(screen.getByText('同意不足 1名').className).toContain('text-state-confirm');
    expect(screen.getByRole('button', { name: '解除' })).toBeTruthy();
  });
});
