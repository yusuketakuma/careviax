// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import PcaPumpsLoading from './loading';

setupDomTestEnv();

describe('PcaPumpsLoading', () => {
  it('uses the PCA-specific loading status for the segment loading file', () => {
    render(<PcaPumpsLoading />);

    expect(screen.getByRole('status', { name: 'PCAポンプレンタルを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
  });
});
