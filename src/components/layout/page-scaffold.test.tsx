// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PageScaffold } from './page-scaffold';

setupDomTestEnv();

describe('PageScaffold', () => {
  it('uses the shared neutral work-plane grammar by default', () => {
    render(
      <PageScaffold>
        <header data-page-header="true">Header</header>
        <section>Content</section>
      </PageScaffold>,
    );

    const scaffold = screen.getByTestId('page-scaffold');
    const stack = screen.getByTestId('page-scaffold-stack');

    expect(scaffold.className).toContain('p-4');
    expect(scaffold.className).toContain('lg:p-6');
    expect(stack.className).toContain('[&>*]:rounded-md');
    expect(stack.className).toContain('[&>*]:border');
    expect(stack.className).toContain('[&>*]:bg-card');
    expect(stack.className).not.toContain('gradient');
    expect(stack.className).not.toContain('shadow');
    expect(stack.className).not.toContain('rounded-xl');
    expect(stack.className).not.toContain('rounded-2xl');
    expect(stack.className).not.toContain('overflow-hidden');
  });

  it('keeps the bare workbench variant free of card selectors', () => {
    render(
      <PageScaffold variant="bare" testId="bare-page">
        <section>Workbench</section>
      </PageScaffold>,
    );

    const stack = screen.getByTestId('bare-page-stack');
    expect(stack.className).toBe('min-h-full w-full space-y-6');
  });

  it('owns the flush-bottom workbench exception as a typed canvas inset', () => {
    render(
      <PageScaffold variant="bare" canvasInset="flush-bottom" testId="flush-page">
        <section>Workbench</section>
      </PageScaffold>,
    );

    const scaffold = screen.getByTestId('flush-page');
    expect(scaffold.getAttribute('data-canvas-inset')).toBe('flush-bottom');
    expect(scaffold.className).toContain('pb-0');
    expect(scaffold.className).toContain('lg:pb-0');
  });
});
