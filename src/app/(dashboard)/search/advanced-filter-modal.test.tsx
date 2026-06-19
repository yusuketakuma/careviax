// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { EMPTY_ADVANCED_FILTER } from './advanced-filter.shared';
import { AdvancedFilterModal } from './advanced-filter-modal';

setupDomTestEnv();

describe('AdvancedFilterModal', () => {
  it('associates select filters with visible labels', () => {
    render(
      <AdvancedFilterModal
        open
        onOpenChange={vi.fn()}
        pharmacists={[{ id: 'user_1', name: '山田 花子' }]}
        initialFilter={EMPTY_ADVANCED_FILTER}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('訪問日')).toBeTruthy();
    expect(screen.getByLabelText('担当者')).toBeTruthy();
    expect(screen.getByLabelText('現在の工程')).toBeTruthy();
    expect(screen.getByLabelText('予定の状態')).toBeTruthy();
    expect(screen.getByLabelText('薬切れ')).toBeTruthy();
  });
});
