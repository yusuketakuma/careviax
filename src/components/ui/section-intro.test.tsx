// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { SectionIntro } from './section-intro';

setupDomTestEnv();

describe('SectionIntro', () => {
  it('moves the description into the shared help popover', () => {
    render(<SectionIntro title="今日のタスク" description="優先度順に確認します。" />);

    expect(screen.queryByText('優先度順に確認します。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '今日のタスクの説明' }));
    expect(screen.getByText('優先度順に確認します。')).toBeTruthy();
  });
});
