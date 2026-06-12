// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrintLayout } from './print-layout';

setupDomTestEnv();

describe('PrintLayout', () => {
  it('renders a dedicated screen surface for print-oriented pages', () => {
    render(
      <PrintLayout pharmacyName="テスト薬局">
        <div>本文</div>
      </PrintLayout>
    );

    const root = screen.getByTestId('print-layout-root');
    expect(root.className).toContain('max-w-4xl');
    expect(root.className).toContain('bg-white');
    expect(root.className).toContain('shadow-sm');
    expect(screen.getByText('本文')).toBeTruthy();
  });
});
