// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PageShortcutLinks } from './page-shortcut-links';

setupDomTestEnv();

describe('PageShortcutLinks', () => {
  it('renders compact links for adjacent workflow pages', () => {
    render(
      <PageShortcutLinks
        links={[
          { href: '/tasks', label: 'タスク' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'タスク' }).getAttribute('href')).toEqual('/tasks');
    expect(screen.getByRole('link', { name: 'ワークフロー' }).getAttribute('href')).toEqual('/workflow');
  });
});
