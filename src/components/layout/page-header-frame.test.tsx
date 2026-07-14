// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PageContextBar } from './page-context-bar';
import { PageHeaderFrame } from './page-header-frame';

setupDomTestEnv();

describe('shared page header geometry', () => {
  it('declares one page header while nested headers retain the same rhythm', () => {
    render(
      <PageHeaderFrame>
        <PageContextBar>Patients</PageContextBar>
        <PageHeaderFrame embedded>Patient detail</PageHeaderFrame>
      </PageHeaderFrame>,
    );

    expect(document.querySelectorAll('[data-page-header="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-page-header-frame="true"]')).toHaveLength(2);
    const contextBar = screen.getByText('Patients');
    expect(contextBar.className).toContain('min-h-11');
    expect(contextBar.className).toContain('rounded-md');
    expect(contextBar.className).not.toContain('shadow');
  });
});
