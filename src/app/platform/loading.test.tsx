// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import PlatformLoading from './loading';

setupDomTestEnv();

describe('PlatformLoading', () => {
  it('announces a platform-console loading state with a lightweight table-shaped skeleton', () => {
    const { container } = render(<PlatformLoading />);

    expect(
      screen.getByRole('status', { name: 'プラットフォームコンソールを読み込み中' }),
    ).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
